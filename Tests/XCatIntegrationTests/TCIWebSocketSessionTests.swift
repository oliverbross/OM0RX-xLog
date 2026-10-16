// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import Foundation
import XCTest
@testable import XCatIntegrationCore

final class TCIWebSocketSessionTests: XCTestCase {
    private let endpoint = URL(string: "ws://127.0.0.1:40001")!
    private let address = TCIReceiverAddress(trx: 0, channel: 0)

    func testAppFocusPublishesProducerReceiptWithoutRefreshingConfiguredEvidence() async throws {
        let connection = FakeTCIWebSocketConnection(), time = TCIEvidenceClock()
        let session = TCIReadOnlyWebSocketSession(endpoint: endpoint, configuredAddress: address,
            connector: FakeTCIWebSocketConnector(connections: [connection]), clock: { time.now() })
        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        let initial = try await waitForObservation(session) { $0.availability == .available }
        time.advance(10)
        let receipt = time.now()
        await connection.enqueue(.text("APP_FOCUS:true;"))
        let focused = try await waitForObservation(session, after: initial.sequence) { $0.serverAppFocus != nil }
        XCTAssertEqual(focused.serverAppFocus?.isFocused, true)
        XCTAssertEqual(focused.serverAppFocus?.receivedAt, receipt)
        XCTAssertEqual(focused.evidenceReceivedAt, initial.evidenceReceivedAt)
        XCTAssertEqual(focused.snapshot, initial.snapshot)
        XCTAssertEqual(focused.filterEvidenceSequence, initial.filterEvidenceSequence)
        XCTAssertEqual(focused.splitEvidenceReceivedAt, initial.splitEvidenceReceivedAt)
        XCTAssertNil(focused.lastRXSpotClick)
        XCTAssertNil(focused.serverTransmitFrequency)
        time.advance(10)
        await connection.enqueue(.text("APP_FOCUS:0,true;"))
        let invalid = try await waitForObservation(session, after: focused.sequence) { _ in true }
        XCTAssertEqual(invalid.serverAppFocus, focused.serverAppFocus)
        await connection.enqueue(.text("APP_FOCUS:true;"))
        let repeated = try await waitForObservation(session, after: invalid.sequence) { _ in true }
        time.advance(20)
        XCTAssertEqual(repeated.serverAppFocus?.receivedAt, receipt.addingTimeInterval(10))
        XCTAssertEqual(repeated.evidenceReceivedAt, initial.evidenceReceivedAt)
        XCTAssertEqual(repeated.snapshot, initial.snapshot)
        let sent = await connection.sentTexts()
        XCTAssertTrue(sent.isEmpty)
        await session.disconnect()
        let disconnected = await session.currentObservation()
        XCTAssertNil(disconnected.serverAppFocus)
    }

    func testAppFocusBeforeDiscoveryGrantsNoAuthorityAndReconnectClearsIt() async throws {
        let first = FakeTCIWebSocketConnection(), second = FakeTCIWebSocketConnection()
        let session = TCIReadOnlyWebSocketSession(endpoint: endpoint, configuredAddress: address,
            connector: FakeTCIWebSocketConnector(connections: [first, second]))
        try await session.connect()
        await first.enqueue(.text("APP_FOCUS:false;"))
        let reported = try await waitForObservation(session) { $0.serverAppFocus != nil }
        XCTAssertEqual(reported.serverAppFocus?.isFocused, false)
        XCTAssertEqual(reported.availability, .synchronizing)
        XCTAssertNil(reported.snapshot)
        XCTAssertNil(reported.evidenceReceivedAt)
        await session.disconnect()
        try await session.connect()
        let reconnected = await session.currentObservation()
        XCTAssertGreaterThan(reconnected.generation, reported.generation)
        XCTAssertNil(reconnected.serverAppFocus)
        await first.enqueue(.text("APP_FOCUS:true;"))
        await second.enqueue(.text(Self.discoveryAndState + "ready;"))
        let available = try await waitForObservation(session, after: reconnected.sequence) { $0.availability == .available }
        XCTAssertNil(available.serverAppFocus)
        let firstSent = await first.sentTexts(), secondSent = await second.sentTexts()
        XCTAssertTrue(firstSent.isEmpty)
        XCTAssertTrue(secondSent.isEmpty)
        await session.disconnect()
    }

    func testRXSpotClickPublishesIndependentProducerReceiptWithoutChangingConfiguredEvidence() async throws {
        let connection = FakeTCIWebSocketConnection(), time = TCIEvidenceClock()
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint, configuredAddress: address,
            connector: FakeTCIWebSocketConnector(connections: [connection]), clock: { time.now() }
        )
        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        let initial = try await waitForObservation(session) { $0.availability == .available }
        time.advance(10)
        let receipt = time.now()
        await connection.enqueue(.text("RX_CLICKED_ON_SPOT:1,1,RN6LHF,7147500;"))
        let click = try await waitForObservation(session, after: initial.sequence) { $0.lastRXSpotClick != nil }
        XCTAssertEqual(click.lastRXSpotClick?.address, TCIReceiverAddress(trx: 1, channel: 1))
        XCTAssertEqual(click.lastRXSpotClick?.callsign, "RN6LHF")
        XCTAssertEqual(click.lastRXSpotClick?.frequencyHz, 7_147_500)
        XCTAssertEqual(click.lastRXSpotClick?.receivedAt, receipt)
        XCTAssertEqual(click.snapshot, initial.snapshot)
        XCTAssertEqual(click.evidenceReceivedAt, initial.evidenceReceivedAt)
        XCTAssertEqual(click.filterEvidenceSequence, initial.filterEvidenceSequence)
        XCTAssertEqual(click.splitEvidenceReceivedAt, initial.splitEvidenceReceivedAt)
        XCTAssertNil(click.serverTransmitFrequency)
        time.advance(10)
        await connection.enqueue(.text("RX_CLICKED_ON_SPOT:0,1,RN6LHF;"))
        let invalid = try await waitForObservation(session, after: click.sequence) { _ in true }
        XCTAssertEqual(invalid.lastRXSpotClick, click.lastRXSpotClick)
        await connection.enqueue(.text("RX_CLICKED_ON_SPOT:1,1,RN6LHF,7147500;"))
        let repeated = try await waitForObservation(session, after: invalid.sequence) { _ in true }
        time.advance(20) // Consumer time must not replace producer receipt time.
        XCTAssertEqual(repeated.lastRXSpotClick?.receivedAt, receipt.addingTimeInterval(10))
        XCTAssertEqual(repeated.evidenceReceivedAt, initial.evidenceReceivedAt)
        XCTAssertEqual(repeated.snapshot, initial.snapshot)
        let sent = await connection.sentTexts()
        XCTAssertTrue(sent.isEmpty)
        await session.disconnect()
        let disconnected = await session.currentObservation()
        XCTAssertNil(disconnected.lastRXSpotClick)
    }

    func testRXSpotClickBeforeDiscoveryDoesNotEstablishAuthorityAndReconnectClearsIt() async throws {
        let first = FakeTCIWebSocketConnection(), second = FakeTCIWebSocketConnection()
        let session = TCIReadOnlyWebSocketSession(endpoint: endpoint, configuredAddress: address,
            connector: FakeTCIWebSocketConnector(connections: [first, second]))
        try await session.connect()
        await first.enqueue(.text("RX_CLICKED_ON_SPOT:0,0,OM0RX,14025000;"))
        let click = try await waitForObservation(session) { $0.lastRXSpotClick != nil }
        XCTAssertEqual(click.availability, .synchronizing)
        XCTAssertNil(click.snapshot)
        XCTAssertNil(click.evidenceReceivedAt)
        await session.disconnect()
        try await session.connect()
        let reconnected = await session.currentObservation()
        XCTAssertGreaterThan(reconnected.generation, click.generation)
        XCTAssertNil(reconnected.lastRXSpotClick)
        await first.enqueue(.text("RX_CLICKED_ON_SPOT:0,0,OLD,14025000;"))
        await second.enqueue(.text(Self.discoveryAndState + "ready;"))
        let available = try await waitForObservation(session, after: reconnected.sequence) { $0.availability == .available }
        XCTAssertNil(available.lastRXSpotClick)
        let firstSent = await first.sentTexts(), secondSent = await second.sentTexts()
        XCTAssertTrue(firstSent.isEmpty)
        XCTAssertTrue(secondSent.isEmpty)
        await session.disconnect()
    }

    func testTXFrequencyPublishesOwnProducerReceiptWithoutRefreshingConfiguredEvidence() async throws {
        let connection = FakeTCIWebSocketConnection(), time = TCIEvidenceClock()
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint, configuredAddress: address,
            connector: FakeTCIWebSocketConnector(connections: [connection]), clock: { time.now() }
        )
        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        let initial = try await waitForObservation(session) { $0.availability == .available }
        time.advance(10)
        let receipt = time.now()
        await connection.enqueue(.text("TX_FREQUENCY:7140000;"))
        let reported = try await waitForObservation(session, after: initial.sequence) {
            $0.serverTransmitFrequency != nil
        }
        XCTAssertEqual(reported.serverTransmitFrequency?.frequencyHz, 7_140_000)
        XCTAssertEqual(reported.serverTransmitFrequency?.receivedAt, receipt)
        XCTAssertEqual(reported.evidenceReceivedAt, initial.evidenceReceivedAt)
        XCTAssertEqual(reported.snapshot, initial.snapshot)
        time.advance(10)
        await connection.enqueue(.text("TX_FREQUENCY:0,14025000;"))
        let invalid = try await waitForObservation(session, after: reported.sequence) { _ in true }
        XCTAssertEqual(invalid.serverTransmitFrequency, reported.serverTransmitFrequency)
        XCTAssertEqual(invalid.evidenceReceivedAt, initial.evidenceReceivedAt)
        await connection.enqueue(.text("TX_FREQUENCY:7140000;"))
        let repeated = try await waitForObservation(session, after: invalid.sequence) { _ in true }
        XCTAssertEqual(repeated.serverTransmitFrequency?.receivedAt, time.now())
        let sent = await connection.sentTexts()
        XCTAssertTrue(sent.isEmpty)
        await session.disconnect()
        let disconnected = await session.currentObservation()
        XCTAssertNil(disconnected.serverTransmitFrequency)
    }

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

    func testFatalProtocolFrameAndOversizedBinaryFailClosed() async throws {
        let oversizedConnection = FakeTCIWebSocketConnection()
        let binaryConnection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [oversizedConnection, binaryConnection])
        let limits = TCIProtocolLimits(maximumFrameBytes: 16)
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector,
            limits: limits,
            maximumBinaryMessageBytes: 3
        )

        try await session.connect()
        await oversizedConnection.enqueue(.text(String(repeating: "x", count: 17)))
        let oversized = try await waitForObservation(session) { $0.availability == .unavailable }
        XCTAssertEqual(oversized.failure, .protocolViolation(.frameTooLarge))
        XCTAssertNil(oversized.snapshot)

        try await session.connect()
        await binaryConnection.enqueue(.binary(Data([0, 1, 2, 3])))
        let binary = try await waitForObservation(session, after: oversized.sequence) {
            $0.availability == .unavailable && $0.generation == 2
        }
        XCTAssertEqual(binary.failure, .binaryMessageTooLarge)
        XCTAssertNil(binary.snapshot)
    }

    func testBoundedBinaryIsIgnoredWithoutPublishingAndTextReductionContinues() async throws {
        let connection = FakeTCIWebSocketConnection()
        let connector = FakeTCIWebSocketConnector(connections: [connection])
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint,
            configuredAddress: address,
            connector: connector,
            maximumBinaryMessageBytes: 3
        )

        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        let beforeBinary = try await waitForObservation(session) { $0.availability == .available }

        await connection.enqueue(.binary(Data([0, 1, 2])))
        await connection.enqueue(.text("vfo:0,0,7100000;"))
        let afterText = try await waitForObservation(session, after: beforeBinary.sequence) {
            $0.snapshot?.frequencyHz == 7_100_000
        }
        XCTAssertEqual(afterText.sequence, beforeBinary.sequence + 1)
        XCTAssertEqual(afterText.availability, .available)
        XCTAssertNil(afterText.failure)
        await session.disconnect()
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

    func testExplicitReceiveTuneUsesExactAddressAndRequiresNewerMatchingReadback() async throws {
        let connection = FakeTCIWebSocketConnection(), time = TCIEvidenceClock()
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint, configuredAddress: address,
            connector: FakeTCIWebSocketConnector(connections: [connection]), clock: { time.now() }
        )
        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        let ready = try await waitForObservation(session) { $0.availability == .available }
        XCTAssertEqual(ready.generation, 1)

        let pending = Task {
            try await session.tuneReceive(
                frequencyHz: 7_100_000, mode: "USB", expectedGeneration: 1,
                timeoutNanoseconds: 1_000_000_000
            )
        }
        for _ in 0..<2_000 {
            if await connection.sentTexts().count == 1 { break }
            await Task.yield()
        }
        let sent = await connection.sentTexts()
        XCTAssertEqual(sent, ["VFO:0,0,7100000;MODULATION:0,USB;"])
        time.advance(1)
        await connection.enqueue(.text("vfo:0,0,7100000;"))
        for _ in 0..<30 { await Task.yield() }
        XCTAssertFalse(pending.isCancelled)
        time.advance(1)
        await connection.enqueue(.text("modulation:0,USB;"))
        let confirmed = try await pending.value
        XCTAssertEqual(confirmed.snapshot?.frequencyHz, 7_100_000)
        XCTAssertEqual(confirmed.snapshot?.transceiver.modulation, "USB")
        await session.disconnect()
    }

    func testTuneDisconnectIsUnknownWithoutReconnectOrReplay() async throws {
        let connection = FakeTCIWebSocketConnection(), connector = FakeTCIWebSocketConnector(connections: [connection])
        let session = TCIReadOnlyWebSocketSession(endpoint: endpoint, configuredAddress: address, connector: connector)
        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        _ = try await waitForObservation(session) { $0.availability == .available }
        let pending = Task {
            try await session.tuneReceive(
                frequencyHz: 7_100_000, mode: "USB", expectedGeneration: 1,
                timeoutNanoseconds: 1_000_000_000
            )
        }
        for _ in 0..<2_000 {
            if await connection.sentTexts().count == 1 { break }
            await Task.yield()
        }
        await connection.fail()
        do {
            _ = try await pending.value
            XCTFail("Disconnected tune was confirmed")
        } catch {
            XCTAssertEqual(error as? TCITuneSessionError, .transportClosed)
        }
        let sent = await connection.sentTexts()
        let connects = await connector.connectCount()
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(connects, 1)
    }

    func testTuneTimeoutDoesNotReplayWhenMatchingTelemetryArrivesLate() async throws {
        let connection = FakeTCIWebSocketConnection(), time = TCIEvidenceClock()
        let connector = FakeTCIWebSocketConnector(connections: [connection])
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint, configuredAddress: address, connector: connector, clock: { time.now() }
        )
        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        _ = try await waitForObservation(session) { $0.availability == .available }
        do {
            _ = try await session.tuneReceive(
                frequencyHz: 7_100_000, mode: "USB", expectedGeneration: 1,
                timeoutNanoseconds: 1_000_000
            )
            XCTFail("Unconfirmed tune reported success")
        } catch {
            XCTAssertEqual(error as? TCITuneSessionError, .readbackTimedOut)
        }
        time.advance(1)
        await connection.enqueue(.text("vfo:0,0,7100000;modulation:0,USB;"))
        _ = try await waitForObservation(session) { $0.snapshot?.frequencyHz == 7_100_000 }
        let sent = await connection.sentTexts()
        let connects = await connector.connectCount()
        XCTAssertEqual(sent, ["VFO:0,0,7100000;MODULATION:0,USB;"])
        XCTAssertEqual(connects, 1)
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

    func testProducerEvidenceTimeSurvivesQueuedStreamConsumptionAndResetsOnDisconnect() async throws {
        let connection = FakeTCIWebSocketConnection(), time = TCIEvidenceClock()
        let session = TCIReadOnlyWebSocketSession(
            endpoint: endpoint, configuredAddress: address,
            connector: FakeTCIWebSocketConnector(connections: [connection]), clock: { time.now() }
        )
        // Subscribe now, but deliberately do not consume until much later.
        let stream = await session.observations()
        try await session.connect()
        let initial = await session.currentObservation()
        await connection.enqueue(.text(Self.discoveryAndState))
        let beforeReady = try await waitForObservation(session, after: initial.sequence) { _ in true }
        XCTAssertNil(beforeReady.evidenceReceivedAt)
        time.advance(10)
        await connection.enqueue(.text("ready;"))
        let available = try await waitForObservation(session) { $0.availability == .available }
        XCTAssertEqual(available.evidenceReceivedAt, time.now())
        let producerStamp = time.now()
        time.advance(20)
        var iterator = stream.makeAsyncIterator()
        while let queued = await iterator.next() {
            if queued.availability == .available {
                XCTAssertEqual(queued.evidenceReceivedAt, producerStamp)
                XCTAssertNotEqual(queued.evidenceReceivedAt, time.now())
                break
            }
        }
        await session.disconnect()
        let disconnected = await session.currentObservation()
        XCTAssertNil(disconnected.evidenceReceivedAt)
    }

    func testFilterNeedsNewSameTRXFilterEvidenceAndUsesOneExactFrame() async throws {
        let connection = FakeTCIWebSocketConnection(), time = TCIEvidenceClock()
        let session = TCIReadOnlyWebSocketSession(endpoint: endpoint, configuredAddress: .init(trx: 1, channel: 1),
            connector: FakeTCIWebSocketConnector(connections: [connection]), clock: { time.now() })
        try await session.connect()
        await connection.enqueue(.text(Self.discoveryAndState + "vfo:1,1,7100000;modulation:1,LSB;trx:1,false;rx_filter_band:1,-2900,-70;ready;"))
        _ = try await waitForObservation(session) { $0.availability == .available }
        let pending = Task { try await session.adjustReceiveFilter(lowerHz: -2900, upperHz: -70, expectedGeneration: 1, timeoutNanoseconds: 100_000_000) }
        for _ in 0..<2000 { if await connection.sentTexts().count == 1 { break }; await Task.yield() }
        let sent = await connection.sentTexts()
        XCTAssertEqual(sent, ["RX_FILTER_BAND:1,-2900,-70;RX_FILTER_BAND:1;"])
        time.advance(1)
        await connection.enqueue(.text("ready;trx:1,false;rx_filter_band:0,-2900,-70;rx_filter_band:1,-70,-2900;"))
        do { _ = try await pending.value; XCTFail("Retained/unrelated/invalid filter evidence confirmed") }
        catch { XCTAssertEqual(error as? TCITuneSessionError, .readbackTimedOut) }
        let next = Task { try await session.adjustReceiveFilter(lowerHz: 30, upperHz: 2700, expectedGeneration: 1, timeoutNanoseconds: 1_000_000_000) }
        for _ in 0..<2000 { if await connection.sentTexts().count == 2 { break }; await Task.yield() }
        time.advance(1)
        await connection.enqueue(.text("rx_filter_band:1,30,2700;"))
        let confirmed = try await next.value
        XCTAssertEqual(confirmed.snapshot?.address, .init(trx: 1, channel: 1))
        XCTAssertEqual(confirmed.snapshot?.transceiver.receiveFilter, TCIFilterBand(lowHz: 30, highHz: 2700))
        await session.disconnect()
    }

    func testFilterAdmissionAndDisconnectNeverReconnectOrReplay() async throws {
        let connection = FakeTCIWebSocketConnection(), time = TCIEvidenceClock()
        let connector = FakeTCIWebSocketConnector(connections: [connection])
        let session = TCIReadOnlyWebSocketSession(endpoint: endpoint, configuredAddress: address, connector: connector, clock: { time.now() })
        try await session.connect()
        do { _ = try await session.adjustReceiveFilter(lowerHz: 30, upperHz: 2700, expectedGeneration: 1); XCTFail() }
        catch { XCTAssertEqual(error as? TCITuneSessionError, .notReady) }
        await connection.enqueue(.text(Self.discoveryAndState + "ready;"))
        var latest = try await waitForObservation(session) { $0.availability == .available }
        for (low, high, generation, expected) in [(Int64(-24001), Int64(0), UInt64(1), TCITuneSessionError.invalidTarget),
            (30, 30, 1, .invalidTarget), (30, 2700, 0, .notReady)] {
            do { _ = try await session.adjustReceiveFilter(lowerHz: low, upperHz: high, expectedGeneration: generation); XCTFail() }
            catch { XCTAssertEqual(error as? TCITuneSessionError, expected) }
        }
        time.advance(6)
        do { _ = try await session.adjustReceiveFilter(lowerHz: 30, upperHz: 2700, expectedGeneration: 1); XCTFail() }
        catch { XCTAssertEqual(error as? TCITuneSessionError, .staleObservation) }
        await connection.enqueue(.text("trx:0,true;"))
        latest = try await waitForObservation(session, after: latest.sequence) { $0.snapshot?.transceiver.transmitting == true }
        do { _ = try await session.adjustReceiveFilter(lowerHz: 30, upperHz: 2700, expectedGeneration: 1); XCTFail() }
        catch { XCTAssertEqual(error as? TCITuneSessionError, .transmitting) }
        await connection.enqueue(.text("trx:0,false;"))
        _ = try await waitForObservation(session, after: latest.sequence) { $0.snapshot?.transceiver.transmitting == false }
        let pending = Task { try await session.adjustReceiveFilter(lowerHz: 30, upperHz: 2700, expectedGeneration: 1) }
        for _ in 0..<2000 { if await connection.sentTexts().count == 1 { break }; await Task.yield() }
        do { _ = try await session.tuneReceive(frequencyHz: 7100000, mode: "LSB", expectedGeneration: 1); XCTFail() }
        catch { XCTAssertEqual(error as? TCITuneSessionError, .commandInFlight) }
        await session.disconnect()
        do { _ = try await pending.value; XCTFail() } catch { XCTAssertEqual(error as? TCITuneSessionError, .transportClosed) }
        let calls = await connector.connectCount(), sent = await connection.sentTexts()
        XCTAssertEqual(calls, 1); XCTAssertEqual(sent.count, 1)
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

private final class TCIEvidenceClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Date(timeIntervalSince1970: 1000)
    func now() -> Date { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ seconds: TimeInterval) { lock.lock(); defer { lock.unlock() }; value.addTimeInterval(seconds) }
}

private actor FakeTCIWebSocketConnection: TCIWebSocketConnection {
    private enum Event: Sendable {
        case message(TCIWebSocketMessage)
        case failure
    }

    private var events: [Event] = []
    private var waiter: CheckedContinuation<TCIWebSocketMessage, Error>?
    private var closures = 0
    private var sent: [String] = []
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

    func send(text: String) async throws {
        guard !closed else { throw FakeTransportFailure.closed }
        sent.append(text)
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
    func sentTexts() -> [String] { sent }

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
