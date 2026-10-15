// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import Foundation
import XCTest
@testable import XCatIntegrationCore

final class TCIWebSocketSessionTests: XCTestCase {
    private let endpoint = URL(string: "ws://127.0.0.1:40001")!
    private let address = TCIReceiverAddress(trx: 0, channel: 0)

    func testFreshDiscoveryAndReadyAreRequiredBeforePublishingSnapshot() async throws {
        let connection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [connection])
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector
        )

        let initial = await session.currentObservation()
        XCTAssertEqual(initial.availability, .unavailable)
        try await session.connect()
        let synchronizing = await session.currentObservation()
        XCTAssertEqual(synchronizing.generation, 1)
        XCTAssertEqual(synchronizing.availability, .synchronizing)
        XCTAssertNil(synchronizing.snapshot)

        await connection.enqueue(.text(Self.discoveryAndState))
        let beforeReady = try await waitForObservation(session, after: synchronizing.sequence) {
            $0.availability == .synchronizing
        }
        XCTAssertNil(beforeReady.snapshot)

        await connection.enqueue(.text("ready;"))
        let available = try await waitForObservation(session, after: beforeReady.sequence) {
            $0.availability == .available
        }
        XCTAssertEqual(available.generation, 1)
        XCTAssertEqual(available.snapshot?.frequencyHz, 14_025_000)
        XCTAssertEqual(available.snapshot?.transceiver.modulation, "CW")

        await session.disconnect()
        let disconnected = await session.currentObservation()
        XCTAssertEqual(disconnected.availability, .unavailable)
        XCTAssertNil(disconnected.snapshot)
        XCTAssertNil(disconnected.failure)
        let closeCount = await connection.closeCount()
        XCTAssertEqual(closeCount, 1)
    }

    func testTransportFailureFailsClosedAndDoesNotReconnectAutomatically() async throws {
        let connection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [connection])
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector
        )

        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        let available = try await waitForObservation(session) { $0.availability == .available }
        XCTAssertNotNil(available.snapshot)

        await connection.fail()
        let failed = try await waitForObservation(session, after: available.sequence) {
            $0.availability == .unavailable
        }
        XCTAssertEqual(failed.failure, .transportClosed)
        XCTAssertNil(failed.snapshot)
        let callsAfterFailure = await connector.connectCount()
        XCTAssertEqual(callsAfterFailure, 1)
        for _ in 0..<20 { await Task.yield() }
        let callsAfterYielding = await connector.connectCount()
        XCTAssertEqual(callsAfterYielding, 1)
    }

    func testExplicitReconnectIncrementsGenerationAndRequiresFreshState() async throws {
        let firstConnection = FakeTCIWebSocketConnection()
        let secondConnection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [firstConnection, secondConnection])
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector
        )

        try await session.connect()
        await firstConnection.enqueue(.text(Self.discoveryAndState + "ready;"))
        let first = try await waitForObservation(session) { $0.availability == .available }
        XCTAssertEqual(first.generation, 1)

        await session.disconnect()
        try await session.connect()
        let secondStart = await session.currentObservation()
        XCTAssertEqual(secondStart.generation, 2)
        XCTAssertEqual(secondStart.availability, .synchronizing)
        XCTAssertNil(secondStart.snapshot)

        await secondConnection.enqueue(.text("ready;"))
        let readyWithoutDiscovery = try await waitForObservation(session, after: secondStart.sequence) {
            $0.availability == .synchronizing
        }
        XCTAssertNil(readyWithoutDiscovery.snapshot)

        await secondConnection.enqueue(.text(Self.discoveryAndState))
        let second = try await waitForObservation(session, after: readyWithoutDiscovery.sequence) {
            $0.availability == .available
        }
        XCTAssertEqual(second.generation, 2)
        XCTAssertEqual(second.snapshot?.frequencyHz, 14_025_000)
        let reconnectCalls = await connector.connectCount()
        XCTAssertEqual(reconnectCalls, 2)
        await session.disconnect()
    }

    func testLateTextFromOldConnectionCannotMutateNewGeneration() async throws {
        let oldConnection = FakeTCIWebSocketConnection(closeResumesReceive: false)
        let currentConnection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [oldConnection, currentConnection])
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector
        )

        try await session.connect()
        await session.disconnect()
        try await session.connect()
        await currentConnection.enqueue(.text(Self.discoveryAndState + "ready;"))
        let current = try await waitForObservation(session) {
            $0.generation == 2 && $0.availability == .available
        }
        XCTAssertEqual(current.snapshot?.frequencyHz, 14_025_000)

        let staleState = Self.discoveryAndState
            .replacingOccurrences(of: "14025000", with: "7100000") + "ready;"
        await oldConnection.enqueue(.text(staleState))
        for _ in 0..<100 { await Task.yield() }

        let afterStaleMessage = await session.currentObservation()
        XCTAssertEqual(afterStaleMessage, current)
        XCTAssertEqual(afterStaleMessage.snapshot?.frequencyHz, 14_025_000)
        await session.disconnect()
    }

    func testFatalProtocolFrameAndUnexpectedBinaryFailClosed() async throws {
        let oversizedConnection = FakeTCIWebSocketConnection()
        let binaryConnection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [oversizedConnection, binaryConnection])
        let limits = TCIProtocolLimits(maximumFrameBytes: 16)
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector,
            limits: limits
        )

        try await session.connect()
        await oversizedConnection.enqueue(.text(String(repeating: "x", count: 17)))
        let oversized = try await waitForObservation(session) { $0.availability == .unavailable }
        XCTAssertEqual(oversized.failure, .protocolViolation(.frameTooLarge))
        XCTAssertNil(oversized.snapshot)

        try await session.connect()
        await binaryConnection.enqueue(.binary(Data([0, 1, 2])))
        let binary = try await waitForObservation(session, after: oversized.sequence) {
            $0.availability == .unavailable && $0.generation == 2
        }
        XCTAssertEqual(binary.failure, .unexpectedBinaryMessage)
        XCTAssertNil(binary.snapshot)
    }

    func testEndpointAndDuplicateConnectAdmissionAreFailClosed() async throws {
        let connection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [connection])
        let invalid = TCIReadOnlyWebSocketSession(
            endpoint: URL(string: "https://127.0.0.1:40001")!,
            configuredAddress: address,
            connector: connector
        )
        do {
            try await invalid.connect()
            XCTFail("Expected invalid endpoint rejection")
        } catch {
            XCTAssertEqual(error as? TCIReadOnlySessionError, .invalidEndpoint)
        }
        let invalidEndpointCalls = await connector.connectCount()
        XCTAssertEqual(invalidEndpointCalls, 0)

        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector
        )
        try await session.connect()
        do {
            try await session.connect()
            XCTFail("Expected duplicate connection rejection")
        } catch {
            XCTAssertEqual(error as? TCIReadOnlySessionError, .alreadyConnected)
        }
        let admittedCalls = await connector.connectCount()
        XCTAssertEqual(admittedCalls, 1)
        await session.disconnect()
    }

    func testConnectionOpenFailurePublishesUnavailableWithoutAutomaticRetry() async {
        let connector = FakeTCIWebSocketConnector(connections: [])
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector
        )

        do {
            try await session.connect()
            XCTFail("Expected connection failure")
        } catch {
            XCTAssertEqual(error as? TCIReadOnlySessionError, .connectionFailed)
        }
        let observation = await session.currentObservation()
        XCTAssertEqual(observation.generation, 1)
        XCTAssertEqual(observation.availability, .unavailable)
        XCTAssertEqual(observation.failure, .connectionFailed)
        XCTAssertNil(observation.snapshot)
        for _ in 0..<20 { await Task.yield() }
        let connectCalls = await connector.connectCount()
        XCTAssertEqual(connectCalls, 1)
    }

    func testDroppingLastSessionReferenceClosesPendingConnection() async throws {
        let connection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [connection])
        weak var releasedSession: TCIReadOnlyWebSocketSession?

        do {
            var session: TCIReadOnlyWebSocketSession? = TCIReadOnlyWebSocketSession(
                endpoint: endpoint,
                configuredAddress: address,
                connector: connector
            )
            releasedSession = session
            try await session?.connect()
            session = nil
        }

        for _ in 0..<2_000 {
            if releasedSession == nil, await connection.closeCount() > 0 { break }
            await Task.yield()
        }
        XCTAssertNil(releasedSession)
        let closeCount = await connection.closeCount()
        XCTAssertEqual(closeCount, 1)
    }

    private func waitForObservation(
        _ session: TCIReadOnlyWebSocketSession,
        after sequence: UInt64 = 0,
        matching predicate: (TCIReadOnlySessionObservation) -> Bool
    ) async throws -> TCIReadOnlySessionObservation {
        for _ in 0..<2_000 {
            let observation = await session.currentObservation()
            if observation.sequence > sequence, predicate(observation) { return observation }
            await Task.yield()
        }
        throw TestFailure.timedOut
    }

    private static let discoveryAndState = """
    protocol:ExpertSDR3,1.8;
    device:SunSDR2PRO;
    receive_only:false;
    trx_count:2;
    channels_count:2;
    vfo_limits:0.0,160000000.0;
    if_limits:-156250,156250;
    modulations_list:AM,LSB,USB,CW,FT8;
    vfo:0,0,14025000;
    modulation:0,CW;
    rx_filter_band:0,-500,500;
    rx_enable:0,true;
    tx_enable:0,true;
    split_enable:0,false;
    trx:0,false;
    tune:0,false;
    """
}

private enum TestFailure: Error {
    case timedOut
}

private enum FakeTransportFailure: Error {
    case closed
}

private actor FakeTCIWebSocketConnection: TCIWebSocketConnection {
    private enum Event: Sendable {
        case message(TCIWebSocketMessage)
        case failure
    }

    private var events: [Event] = []
    private var waiter: CheckedContinuation<TCIWebSocketMessage, Error>?
    private var closures = 0
    private var closed = false
    private let closeResumesReceive: Bool

    init(closeResumesReceive: Bool = true) {
        self.closeResumesReceive = closeResumesReceive
    }

    func receive() async throws -> TCIWebSocketMessage {
        if !events.isEmpty { return try consume(events.removeFirst()) }
        if closed { throw FakeTransportFailure.closed }
        return try await withCheckedThrowingContinuation { waiter = $0 }
    }

    func close() async {
        closures += 1
        closed = true
        if closeResumesReceive {
            waiter?.resume(throwing: FakeTransportFailure.closed)
            waiter = nil
        }
    }

    func enqueue(_ message: TCIWebSocketMessage) {
        deliver(.message(message))
    }

    func fail() {
        deliver(.failure)
    }

    func closeCount() -> Int { closures }

    private func deliver(_ event: Event) {
        guard let waiter else {
            events.append(event)
            return
        }
        self.waiter = nil
        switch event {
        case let .message(message): waiter.resume(returning: message)
        case .failure: waiter.resume(throwing: FakeTransportFailure.closed)
        }
    }

    private func consume(_ event: Event) throws -> TCIWebSocketMessage {
        switch event {
        case let .message(message): message
        case .failure: throw FakeTransportFailure.closed
        }
    }
}

private actor FakeTCIWebSocketConnector: TCIWebSocketConnecting {
    private var connections: [FakeTCIWebSocketConnection]
    private var calls = 0

    init(connections: [FakeTCIWebSocketConnection]) {
        self.connections = connections
    }

    func connect(to endpoint: URL) async throws -> any TCIWebSocketConnection {
        calls += 1
        guard !connections.isEmpty else { throw FakeTransportFailure.closed }
        return connections.removeFirst()
    }

    func connectCount() -> Int { calls }
}
