// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum TCIWebSocketMessage: Equatable, Sendable {
    case text(String)
    case binary(Data)
}

/// Bounded TCI transport surface. The session below exposes only explicit
/// receive-VFO tuning and TRX filter writes; transport grants no command authority.
public protocol TCIWebSocketConnection: Sendable {
    func receive() async throws -> TCIWebSocketMessage
    func send(text: String) async throws
    func close() async
}

public protocol TCIWebSocketConnecting: Sendable {
    func connect(to endpoint: URL) async throws -> any TCIWebSocketConnection
}

public final class NativeTCIWebSocketConnector: TCIWebSocketConnecting, @unchecked Sendable {
    private let session: URLSession
    private let maximumMessageBytes: Int

    public init(session: URLSession = .shared, maximumMessageBytes: Int = 65_536) {
        self.session = session
        self.maximumMessageBytes = max(1, maximumMessageBytes)
    }

    public func connect(to endpoint: URL) async throws -> any TCIWebSocketConnection {
        let task = session.webSocketTask(with: endpoint)
        task.maximumMessageSize = maximumMessageBytes
        task.resume()
        return NativeTCIWebSocketConnection(task: task)
    }
}

private final class NativeTCIWebSocketConnection: TCIWebSocketConnection, @unchecked Sendable {
    private let task: URLSessionWebSocketTask

    init(task: URLSessionWebSocketTask) {
        self.task = task
    }

    func receive() async throws -> TCIWebSocketMessage {
        switch try await task.receive() {
        case let .string(value): .text(value)
        case let .data(value): .binary(value)
        @unknown default: throw TCIReadOnlySessionError.connectionFailed
        }
    }

    func send(text: String) async throws {
        try await task.send(.string(text))
    }

    func close() async {
        task.cancel(with: .normalClosure, reason: nil)
    }

    deinit {
        task.cancel(with: .goingAway, reason: nil)
    }
}

public enum TCIReadOnlySessionAvailability: String, Equatable, Sendable {
    case unavailable
    case connecting
    case synchronizing
    case available
}

public enum TCIReadOnlySessionFailure: Equatable, Sendable {
    case connectionFailed
    case transportClosed
    case protocolViolation(TCIDiagnosticKind)
    case binaryMessageTooLarge
}

public enum TCIReadOnlySessionError: Error, Equatable, Sendable {
    case invalidEndpoint
    case alreadyConnected
    case cancelled
    case connectionFailed
    case generationExhausted
}

public enum TCITuneSessionError: Error, Equatable, Sendable {
    case invalidTarget
    case notReady
    case staleObservation
    case transmitting
    case commandInFlight
    case connectionChanged
    case transportClosed
    case readbackTimedOut
}

public struct TCIReadOnlySessionObservation: Equatable, Sendable {
    public let sequence: UInt64
    public let generation: UInt64
    public let availability: TCIReadOnlySessionAvailability
    public let snapshot: TCIAuthoritativeSnapshot?
    public let failure: TCIReadOnlySessionFailure?
    /// Producer receipt time of the latest accepted configured/global evidence.
    /// Nil until an authoritative configured snapshot exists; never consumer time.
    public let evidenceReceivedAt: Date?
    /// Sequence of the latest accepted configured-TRX RX_FILTER_BAND report.
    public let filterEvidenceSequence: UInt64
    /// Receipt of an accepted SPLIT_ENABLE report for the configured TRX only.
    public let splitEvidenceReceivedAt: Date?

    public init(
        sequence: UInt64,
        generation: UInt64,
        availability: TCIReadOnlySessionAvailability,
        snapshot: TCIAuthoritativeSnapshot?,
        failure: TCIReadOnlySessionFailure?,
        evidenceReceivedAt: Date? = nil,
        filterEvidenceSequence: UInt64 = 0,
        splitEvidenceReceivedAt: Date? = nil
    ) {
        self.sequence = sequence
        self.generation = generation
        self.availability = availability
        self.snapshot = snapshot
        self.failure = failure
        self.evidenceReceivedAt = evidenceReceivedAt
        self.filterEvidenceSequence = filterEvidenceSequence
        self.splitEvidenceReceivedAt = splitEvidenceReceivedAt
    }
}

/// Explicitly managed TCI receive-control WebSocket session. Every connection
/// generation starts with an empty decoder and reducer and must receive fresh
/// discovery plus READY before an authoritative snapshot is published.
public actor TCIReadOnlyWebSocketSession {
    public let endpoint: URL
    public let configuredAddress: TCIReceiverAddress

    private let connector: any TCIWebSocketConnecting
    private let limits: TCIProtocolLimits
    private let maximumBinaryMessageBytes: Int
    private let clock: @Sendable () -> Date
    private var evidenceReceivedAt: Date?
    private var splitEvidenceReceivedAt: Date?
    private var decoder: TCITextDecoder
    private var reducer: TCIStateReducer
    private var connection: (any TCIWebSocketConnection)?
    private var connectionID: UUID?
    private var receiveTask: Task<Void, Never>?
    private var connecting = false
    private var generation: UInt64 = 0
    private var lifecycleRevision: UInt64 = 0
    private var sequence: UInt64 = 0
    private var observationValue: TCIReadOnlySessionObservation
    private var commandInFlight = false
    private var filterEvidenceSequence: UInt64 = 0
    private var continuations: [UUID: AsyncStream<TCIReadOnlySessionObservation>.Continuation] = [:]

    public init(
        endpoint: URL,
        configuredAddress: TCIReceiverAddress,
        connector: any TCIWebSocketConnecting = NativeTCIWebSocketConnector(),
        limits: TCIProtocolLimits = .default,
        maximumBinaryMessageBytes: Int = 65_536,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.endpoint = endpoint
        self.configuredAddress = configuredAddress
        self.connector = connector
        self.limits = limits
        self.maximumBinaryMessageBytes = max(1, maximumBinaryMessageBytes)
        self.clock = clock
        decoder = TCITextDecoder(limits: limits)
        reducer = TCIStateReducer(limits: limits)
        observationValue = TCIReadOnlySessionObservation(
            sequence: 0,
            generation: 0,
            availability: .unavailable,
            snapshot: nil,
            failure: nil
        )
    }

    deinit {
        receiveTask?.cancel()
        for continuation in continuations.values { continuation.finish() }
        if let connection {
            Task.detached(priority: .utility) { await connection.close() }
        }
    }

    public func currentObservation() -> TCIReadOnlySessionObservation {
        observationValue
    }

    public func observations(
        bufferingNewest limit: Int = 16
    ) -> AsyncStream<TCIReadOnlySessionObservation> {
        let observerID = UUID()
        let pair = AsyncStream<TCIReadOnlySessionObservation>.makeStream(
            bufferingPolicy: .bufferingNewest(min(max(1, limit), 1_024))
        )
        continuations[observerID] = pair.continuation
        pair.continuation.yield(observationValue)
        pair.continuation.onTermination = { [weak self] _ in
            Task { await self?.removeContinuation(observerID) }
        }
        return pair.stream
    }

    public func connect() async throws {
        guard Self.isValidEndpoint(endpoint) else { throw TCIReadOnlySessionError.invalidEndpoint }
        guard !connecting, connection == nil, receiveTask == nil else {
            throw TCIReadOnlySessionError.alreadyConnected
        }
        guard generation < UInt64.max, lifecycleRevision < UInt64.max else {
            throw TCIReadOnlySessionError.generationExhausted
        }

        generation += 1
        lifecycleRevision += 1
        let connectionGeneration = generation
        let connectionRevision = lifecycleRevision
        connecting = true
        resetProtocolState()
        publish(availability: .connecting, snapshot: nil, failure: nil)

        let openedConnection: any TCIWebSocketConnection
        do {
            openedConnection = try await connector.connect(to: endpoint)
        } catch {
            guard generation == connectionGeneration,
                  lifecycleRevision == connectionRevision
            else { throw TCIReadOnlySessionError.cancelled }
            connecting = false
            resetProtocolState()
            publish(availability: .unavailable, snapshot: nil, failure: .connectionFailed)
            throw TCIReadOnlySessionError.connectionFailed
        }

        guard connecting,
              generation == connectionGeneration,
              lifecycleRevision == connectionRevision
        else {
            await openedConnection.close()
            throw TCIReadOnlySessionError.cancelled
        }

        connecting = false
        connection = openedConnection
        let openedConnectionID = UUID()
        connectionID = openedConnectionID
        publish(availability: .synchronizing, snapshot: nil, failure: nil)
        let receiptClock = clock
        receiveTask = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let message = try await openedConnection.receive()
                    let receivedAt = receiptClock()
                    guard await self?.process(
                        message,
                        receivedAt: receivedAt,
                        connection: openedConnection,
                        connectionID: openedConnectionID,
                        generation: connectionGeneration,
                        revision: connectionRevision
                    ) == true else { return }
                }
            } catch {
                await self?.fail(
                    .transportClosed,
                    connection: openedConnection,
                    connectionID: openedConnectionID,
                    generation: connectionGeneration,
                    revision: connectionRevision
                )
            }
        }
    }

    public func disconnect() async {
        if lifecycleRevision < UInt64.max { lifecycleRevision += 1 }
        connecting = false
        receiveTask?.cancel()
        receiveTask = nil
        let closingConnection = connection
        connection = nil
        connectionID = nil
        resetProtocolState()
        publish(availability: .unavailable, snapshot: nil, failure: nil)
        await closingConnection?.close()
    }

    /// Sends one exact configured receiver target and returns only after newer,
    /// authoritative TCI telemetry confirms both frequency and modulation.
    /// There is no retry or replay on write loss, timeout, or disconnect.
    public func tuneReceive(
        frequencyHz: Int64,
        mode: String,
        expectedGeneration: UInt64,
        timeoutNanoseconds: UInt64 = 12_000_000_000
    ) async throws -> TCIReadOnlySessionObservation {
        try await receiveCommand(frequencyHz: frequencyHz, mode: mode, filter: nil,
                                 expectedGeneration: expectedGeneration, timeoutNanoseconds: timeoutNanoseconds)
    }

    /// Official TCI b081213f page 20: RX_FILTER_BAND is TRX-wide, not channel-wide.
    /// One setter and one explicit read share the existing socket and attempt.
    public func adjustReceiveFilter(lowerHz: Int64, upperHz: Int64, expectedGeneration: UInt64,
                                    timeoutNanoseconds: UInt64 = 12_000_000_000) async throws -> TCIReadOnlySessionObservation {
        // Conservative application limit; the official command advertises no range.
        guard (-24_000...24_000).contains(lowerHz), (-24_000...24_000).contains(upperHz), lowerHz < upperHz else {
            throw TCITuneSessionError.invalidTarget
        }
        return try await receiveCommand(frequencyHz: 0, mode: "", filter: TCIFilterBand(lowHz: lowerHz, highHz: upperHz),
                                        expectedGeneration: expectedGeneration, timeoutNanoseconds: timeoutNanoseconds)
    }

    private func receiveCommand(frequencyHz: Int64, mode: String, filter: TCIFilterBand?, expectedGeneration: UInt64,
                                timeoutNanoseconds: UInt64) async throws -> TCIReadOnlySessionObservation {
        guard timeoutNanoseconds > 0, timeoutNanoseconds <= 120_000_000_000 else {
            throw TCITuneSessionError.invalidTarget
        }
        guard !commandInFlight else { throw TCITuneSessionError.commandInFlight }
        guard expectedGeneration == generation,
              observationValue.generation == generation,
              observationValue.availability == .available,
              let snapshot = observationValue.snapshot,
              snapshot.address == configuredAddress,
              let activeConnection = connection,
              let activeConnectionID = connectionID else {
            throw TCITuneSessionError.notReady
        }
        guard snapshot.transceiver.transmitting == false else {
            throw TCITuneSessionError.transmitting
        }
        if filter != nil, snapshot.transceiver.receiveFilter == nil { throw TCITuneSessionError.notReady }
        let issuedAt = clock()
        guard issuedAt.timeIntervalSince(observationValue.evidenceReceivedAt ?? .distantPast) >= -1,
              issuedAt.timeIntervalSince(observationValue.evidenceReceivedAt ?? .distantPast) <= 5 else {
            throw TCITuneSessionError.staleObservation
        }
        let lower = Int64(snapshot.vfoLimits.lower.rounded(.up))
        let upper = Int64(snapshot.vfoLimits.upper.rounded(.down))
        guard lower <= upper else { throw TCITuneSessionError.notReady }
        let encoder: TCICommandEncoder
        do {
            encoder = try TCICommandEncoder(
                trxCount: snapshot.trxCount,
                channelCount: snapshot.channelCount,
                frequencyRange: lower...upper,
                supportedModulations: Set(snapshot.supportedModulations),
                limits: limits
            )
        } catch {
            throw TCITuneSessionError.notReady
        }
        let normalizedMode = mode.uppercased()
        let frame: String
        do {
            frame = try encoder.encodeFrame(filter.map { [
                .setRXFilterBand(trx: configuredAddress.trx, lowerHz: $0.lowHz, upperHz: $0.highHz),
                .readRXFilterBand(trx: configuredAddress.trx)
            ] } ?? [
                .setVFO(address: configuredAddress, frequencyHz: frequencyHz),
                .setModulation(trx: configuredAddress.trx, mode: normalizedMode),
            ])
        } catch {
            throw TCITuneSessionError.invalidTarget
        }

        let activeGeneration = generation
        let activeRevision = lifecycleRevision
        let baselineSequence = observationValue.sequence
        let stream = observations(bufferingNewest: 32)
        commandInFlight = true
        defer { commandInFlight = false }
        do {
            try await activeConnection.send(text: frame)
        } catch {
            await fail(
                .transportClosed,
                connection: activeConnection,
                connectionID: activeConnectionID,
                generation: activeGeneration,
                revision: activeRevision
            )
            throw TCITuneSessionError.transportClosed
        }

        let confirmed: TCIReadOnlySessionObservation
        do {
            confirmed = try await Self.waitForTuneReadback(
                stream: stream,
                after: baselineSequence,
                generation: activeGeneration,
                issuedAt: issuedAt,
                frequencyHz: frequencyHz,
                mode: normalizedMode,
                filter: filter,
                timeoutNanoseconds: timeoutNanoseconds
            )
        } catch let failure as TCITuneSessionError {
            throw failure
        } catch {
            throw TCITuneSessionError.transportClosed
        }
        guard generation == activeGeneration,
              lifecycleRevision == activeRevision,
              connectionID == activeConnectionID,
              connection != nil,
              observationValue.sequence >= confirmed.sequence,
              observationValue.availability == .available,
              observationValue.snapshot?.transceiver.transmitting == false,
              filter == nil || observationValue.snapshot?.transceiver.receiveFilter == filter else {
            throw TCITuneSessionError.connectionChanged
        }
        return confirmed
    }

    private static func waitForTuneReadback(
        stream: AsyncStream<TCIReadOnlySessionObservation>,
        after baselineSequence: UInt64,
        generation: UInt64,
        issuedAt: Date,
        frequencyHz: Int64,
        mode: String,
        filter: TCIFilterBand?,
        timeoutNanoseconds: UInt64
    ) async throws -> TCIReadOnlySessionObservation {
        try await withThrowingTaskGroup(of: TCIReadOnlySessionObservation.self) { group in
            group.addTask {
                for await value in stream {
                    guard value.generation == generation else { throw TCITuneSessionError.connectionChanged }
                    guard value.availability != .unavailable else { throw TCITuneSessionError.transportClosed }
                    guard value.sequence > baselineSequence,
                          value.evidenceReceivedAt.map({ $0 > issuedAt }) == true,
                          let snapshot = value.snapshot,
                          filter.map({ snapshot.transceiver.receiveFilter == $0 && value.filterEvidenceSequence > baselineSequence })
                            ?? (snapshot.frequencyHz == frequencyHz && snapshot.transceiver.modulation?.uppercased() == mode),
                          snapshot.transceiver.transmitting == false else { continue }
                    return value
                }
                throw TCITuneSessionError.transportClosed
            }
            group.addTask {
                try await Task.sleep(nanoseconds: timeoutNanoseconds)
                throw TCITuneSessionError.readbackTimedOut
            }
            defer { group.cancelAll() }
            guard let result = try await group.next() else {
                throw TCITuneSessionError.transportClosed
            }
            return result
        }
    }

    private func process(
        _ message: TCIWebSocketMessage,
        receivedAt: Date,
        connection activeConnection: any TCIWebSocketConnection,
        connectionID activeConnectionID: UUID,
        generation activeGeneration: UInt64,
        revision activeRevision: UInt64
    ) async -> Bool {
        guard generation == activeGeneration,
              lifecycleRevision == activeRevision,
              connectionID == activeConnectionID,
              connection != nil
        else { return false }
        switch message {
        case let .text(value):
            let result = decoder.feed(value)
            if let fatal = result.diagnostics.first(where: Self.isFatalProtocolDiagnostic) {
                await fail(
                    .protocolViolation(fatal.kind),
                    connection: activeConnection,
                    connectionID: activeConnectionID,
                    generation: activeGeneration,
                    revision: activeRevision
                )
                return false
            }
            // Keep diagnostics behavior, but use each reducer acceptance result
            // rather than state inequality: valid repeated values are evidence.
            reducer.apply(TCITextDecodeResult(commands: [], diagnostics: result.diagnostics))
            var hasConfiguredEvidence = false
            for command in result.commands {
                if reducer.apply(command), isConfiguredEvidence(command) {
                    hasConfiguredEvidence = true
                    if command.name == "RX_FILTER_BAND" { filterEvidenceSequence = sequence + 1 }
                    if command.name == "SPLIT_ENABLE" { splitEvidenceReceivedAt = receivedAt }
                }
            }
            if let snapshot = reducer.authoritativeSnapshot(for: configuredAddress) {
                if hasConfiguredEvidence { evidenceReceivedAt = receivedAt }
                publish(availability: .available, snapshot: snapshot, failure: nil)
            } else {
                evidenceReceivedAt = nil
                publish(availability: .synchronizing, snapshot: nil, failure: nil)
            }
            return true

        case let .binary(value):
            // ExpertSDR can send unsolicited line-output audio to every client.
            // This read-only state session deliberately ignores bounded binary
            // payloads; they do not enter the text decoder or publish state.
            guard value.count <= maximumBinaryMessageBytes else {
                await fail(
                    .binaryMessageTooLarge,
                    connection: activeConnection,
                    connectionID: activeConnectionID,
                    generation: activeGeneration,
                    revision: activeRevision
                )
                return false
            }
            return true
        }
    }

    private func fail(
        _ failure: TCIReadOnlySessionFailure,
        connection activeConnection: any TCIWebSocketConnection,
        connectionID activeConnectionID: UUID,
        generation activeGeneration: UInt64,
        revision activeRevision: UInt64
    ) async {
        guard generation == activeGeneration,
              lifecycleRevision == activeRevision,
              connectionID == activeConnectionID,
              connection != nil
        else { return }
        if lifecycleRevision < UInt64.max { lifecycleRevision += 1 }
        receiveTask = nil
        connection = nil
        connectionID = nil
        connecting = false
        resetProtocolState()
        publish(availability: .unavailable, snapshot: nil, failure: failure)
        await activeConnection.close()
    }

    private func resetProtocolState() {
        decoder = TCITextDecoder(limits: limits)
        reducer = TCIStateReducer(limits: limits)
        evidenceReceivedAt = nil
        filterEvidenceSequence = 0
        splitEvidenceReceivedAt = nil
    }

    private func publish(
        availability: TCIReadOnlySessionAvailability,
        snapshot: TCIAuthoritativeSnapshot?,
        failure: TCIReadOnlySessionFailure?
    ) {
        if sequence < UInt64.max { sequence += 1 }
        observationValue = TCIReadOnlySessionObservation(
            sequence: sequence,
            generation: generation,
            availability: availability,
            snapshot: snapshot,
            failure: failure,
            evidenceReceivedAt: evidenceReceivedAt,
            filterEvidenceSequence: filterEvidenceSequence,
            splitEvidenceReceivedAt: splitEvidenceReceivedAt
        )
        for continuation in continuations.values {
            continuation.yield(observationValue)
        }
    }

    private func removeContinuation(_ id: UUID) {
        continuations.removeValue(forKey: id)
    }

    private func isConfiguredEvidence(_ command: TCICommand) -> Bool {
        switch command.name {
        case "PROTOCOL", "DEVICE", "RECEIVE_ONLY", "TRX_COUNT", "CHANNEL_COUNT", "CHANNELS_COUNT",
             "VFO_LIMITS", "IF_LIMITS", "MODULATIONS_LIST", "START", "STOP", "READY":
            return true
        case "VFO":
            return command.arguments.count == 3
                && TCIValueParser.integer(command.arguments[0]) == configuredAddress.trx
                && TCIValueParser.integer(command.arguments[1]) == configuredAddress.channel
        case "MODULATION", "RX_FILTER_BAND", "SPLIT_ENABLE", "RX_ENABLE", "TX_ENABLE", "TRX", "TUNE":
            return command.arguments.first.flatMap(TCIValueParser.integer) == configuredAddress.trx
        default:
            return false
        }
    }

    private static func isValidEndpoint(_ endpoint: URL) -> Bool {
        guard let scheme = endpoint.scheme?.lowercased(),
              scheme == "ws" || scheme == "wss",
              endpoint.host?.isEmpty == false,
              endpoint.user == nil,
              endpoint.password == nil
        else { return false }
        return true
    }

    private static func isFatalProtocolDiagnostic(_ diagnostic: TCIDiagnostic) -> Bool {
        switch diagnostic.kind {
        case .frameTooLarge, .accumulatorTooLarge, .tooManyCommands, .invalidASCII:
            true
        case .commandTooLarge, .invalidCommandName, .tooManyArguments, .argumentTooLarge,
             .invalidArguments, .outOfBounds, .unknownCommand:
            false
        }
    }
}
