import Foundation
import XCTest
@testable import XLogPrototypeSupport

#if os(macOS)
final class WorkerTerminalShutdownTests: XCTestCase {
    func testQueuedAndLaterConnectAreRejectedAfterTerminalEOFWithoutNetwork() async {
        let session = LiveStationSession()
        let (gate, release) = AsyncStream<Void>.makeStream()
        // The request was admitted before EOF but has not reached the station
        // actor yet. Releasing the gate models task-group scheduling after EOF.
        let queued = Task {
            for await _ in gate { break }
            return try await session.handle("station_connect", params: [
                "provider": "direct_agent", "base_url": "https://example.invalid/", "token": "fixture",
            ])
        }
        await session.terminate()
        release.yield(())
        release.finish()
        do {
            _ = try await queued.value
            XCTFail("Queued connect ran after terminal EOF")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "worker_stopping")
        } catch {
            XCTFail("Unexpected terminal rejection: \(error)")
        }
        do {
            _ = try await session.handle("station_rotor_connect", params: [
                "provider": "direct_agent", "host": "example.invalid", "port": 4001,
            ])
            XCTFail("Rotor connect ran after terminal EOF")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "worker_stopping")
        } catch {
            XCTFail("Unexpected terminal rejection: \(error)")
        }
    }

    func testWorkerRejectsStationRequestsWhileOtherResponsesCanDrain() async throws {
        let worker = LiveWorker()
        await worker.beginTerminalShutdown()
        let station = await worker.response(to: Data("{\"id\":\"late\",\"method\":\"station_connect\",\"params\":{}}".utf8))
        let stationObject = try XCTUnwrap(JSONSerialization.jsonObject(with: station) as? [String: Any])
        XCTAssertEqual((stationObject["error"] as? [String: Any])?["code"] as? String, "worker_stopping")

        let health = await worker.response(to: Data("{\"id\":\"health\",\"method\":\"health\",\"params\":{}}".utf8))
        let healthObject = try XCTUnwrap(JSONSerialization.jsonObject(with: health) as? [String: Any])
        XCTAssertEqual(healthObject["ok"] as? Bool, true)
    }

    func testOrdinaryDisconnectDoesNotMakeSessionTerminal() async {
        let session = LiveStationSession()
        await session.shutdown()
        do {
            _ = try await session.handle("station_connect", params: [
                "provider": "direct_agent", "base_url": "http://invalid.example/",
            ])
            XCTFail("Invalid endpoint was accepted")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "invalid_params")
        } catch {
            XCTFail("Unexpected ordinary-disconnect result: \(error)")
        }
    }
}
#endif
