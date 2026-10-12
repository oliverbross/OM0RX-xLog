#if os(macOS)
import Foundation
import XCTest
@testable import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class CATConnectionSessionTests: XCTestCase {
    func testDisconnectDefersReleaseUntilAuthorizedTransmitFinishes() async throws {
        let gate = HeldCATCommand()
        let releases = CATDisconnectLedger()
        let session = ConnectionSession(
            framing: .semicolon,
            handler: { command in
                await gate.recordCommand(command)
                await TCPCommandServer.recordAuthorizedTransmitAttempt()
                return await gate.hold()
            },
            transmitIntentResolver: { TCPCommandServer.catTransmitIntent(command: $0, response: $1) },
            onDisconnect: { await releases.record($0) }
        )
        let command = Task { await session.ingest(Data("TX;FA;".utf8)) }
        try await waitUntil { await gate.isHolding() }
        await session.disconnect()
        let pendingReleases = await releases.values()
        XCTAssertTrue(pendingReleases.isEmpty, "Release must follow the late TX write")
        await gate.finish(response: nil)
        let responses = await command.value
        XCTAssertTrue(responses.isEmpty)
        await session.disconnect()
        _ = await session.ingest(Data("TX;".utf8))
        let released = await releases.values()
        let handled = await gate.commands()
        XCTAssertEqual(released, [true])
        XCTAssertEqual(handled, ["TX"], "Disconnected clients cannot execute buffered or new commands")
    }

    func testAmbiguousTransmitReplyRetainsDisconnectRelease() async throws {
        let gate = HeldCATCommand()
        let releases = CATDisconnectLedger()
        let session = ConnectionSession(
            framing: .semicolon,
            handler: { _ in
                await TCPCommandServer.recordAuthorizedTransmitAttempt()
                return await gate.hold()
            },
            transmitIntentResolver: { TCPCommandServer.catTransmitIntent(command: $0, response: $1) },
            onDisconnect: { await releases.record($0) }
        )
        let command = Task { await session.ingest(Data("TX;".utf8)) }
        try await waitUntil { await gate.isHolding() }
        await session.disconnect()
        await gate.finish(response: "?;")
        _ = await command.value
        let released = await releases.values()
        XCTAssertEqual(released, [true], "A failed reply cannot disprove an authorized TX attempt")
    }

    func testReadOnlyAndRejectedClientsDoNotReleaseAnotherOwner() async {
        let ownerReleases = CATDisconnectLedger()
        let otherReleases = CATDisconnectLedger()
        let owner = ConnectionSession(
            framing: .semicolon,
            handler: { _ in
                await TCPCommandServer.recordAuthorizedTransmitAttempt()
                return nil
            },
            transmitIntentResolver: { TCPCommandServer.catTransmitIntent(command: $0, response: $1) },
            onDisconnect: { await ownerReleases.record($0) }
        )
        let reader = ConnectionSession(
            framing: .semicolon,
            handler: { _ in "FA00014074000;" },
            transmitIntentResolver: { TCPCommandServer.catTransmitIntent(command: $0, response: $1) },
            onDisconnect: { await otherReleases.record($0) }
        )
        let rejected = ConnectionSession(
            framing: .semicolon,
            handler: { _ in "?;" },
            transmitIntentResolver: { TCPCommandServer.catTransmitIntent(command: $0, response: $1) },
            onDisconnect: { await otherReleases.record($0) }
        )
        _ = await owner.ingest(Data("TX;".utf8))
        _ = await reader.ingest(Data("FA;".utf8))
        _ = await rejected.ingest(Data("TX;".utf8))
        await reader.disconnect()
        await rejected.disconnect()
        let ownerBeforeDisconnect = await ownerReleases.values()
        let otherDisconnected = await otherReleases.values()
        XCTAssertTrue(ownerBeforeDisconnect.isEmpty)
        XCTAssertEqual(otherDisconnected, [false, false])
        await owner.disconnect()
        let ownerDisconnected = await ownerReleases.values()
        XCTAssertEqual(ownerDisconnected, [true])
    }

    func testDrainWaitsForDisconnectReleaseCallbackBeforeFinalStationRelease() async throws {
        let commandGate = HeldCATCommand()
        let releaseGate = HeldCATCommand()
        let events = CATLifecycleEvents()
        let session = ConnectionSession(
            framing: .semicolon,
            handler: { _ in
                await TCPCommandServer.recordAuthorizedTransmitAttempt()
                return await commandGate.hold()
            },
            transmitIntentResolver: { TCPCommandServer.catTransmitIntent(command: $0, response: $1) },
            onDisconnect: { owned in
                if owned {
                    await events.record("listener release started")
                    _ = await releaseGate.hold()
                    await events.record("listener release finished")
                }
            }
        )
        let command = Task { await session.ingest(Data("TX;".utf8)) }
        try await waitUntil { await commandGate.isHolding() }
        await session.disconnect()
        let drain = Task {
            await session.disconnectAndWait()
            await events.record("final station release")
        }
        await commandGate.finish(response: "?;")
        try await waitUntil { await releaseGate.isHolding() }
        let duringRelease = await events.values()
        XCTAssertEqual(duringRelease, ["listener release started"])
        await releaseGate.finish(response: nil)
        await drain.value
        _ = await command.value
        let complete = await events.values()
        XCTAssertEqual(complete, ["listener release started", "listener release finished", "final station release"])
    }

    func testOverlappingStationRetirementCannotSkipEarlierDrain() async throws {
        var retirement = StationCATRetirement()
        let gate = HeldCATCommand()
        let events = CATLifecycleEvents()
        _ = retirement.enqueue {
            await events.record("old listener draining")
            _ = await gate.hold()
            await events.record("old listener drained")
        }
        try await waitUntil { await gate.isHolding() }
        // A concurrent shutdown sees no listener pointer, but it must still
        // wait for the retirement that already took ownership of that listener.
        let shutdown = retirement.enqueue { await events.record("final owned release") }
        let pending = await events.values()
        XCTAssertEqual(pending, ["old listener draining"])
        await gate.finish(response: nil)
        await shutdown.value
        let completed = await events.values()
        XCTAssertEqual(completed, ["old listener draining", "old listener drained", "final owned release"])
    }

    private func waitUntil(_ condition: @escaping () async -> Bool) async throws {
        for _ in 0..<100 {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("Timed out waiting for held CAT command")
        throw NSError(domain: "CATConnectionSessionTests", code: 1)
    }
}

private actor HeldCATCommand {
    private var continuation: CheckedContinuation<String?, Never>?
    private var receivedCommands: [String] = []
    func recordCommand(_ command: String) { receivedCommands.append(command) }
    func commands() -> [String] { receivedCommands }
    func isHolding() -> Bool { continuation != nil }
    func hold() async -> String? {
        await withCheckedContinuation { continuation = $0 }
    }
    func finish(response: String?) {
        continuation?.resume(returning: response)
        continuation = nil
    }
}

private actor CATDisconnectLedger {
    private var disconnects: [Bool] = []
    func record(_ ownedTransmit: Bool) { disconnects.append(ownedTransmit) }
    func values() -> [Bool] { disconnects }
}

private actor CATLifecycleEvents {
    private var events: [String] = []
    func record(_ event: String) { events.append(event) }
    func values() -> [String] { events }
}
#endif
