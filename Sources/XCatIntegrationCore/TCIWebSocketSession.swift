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

/// Receive-only transport surface. Deliberately has no send operation.
public protocol TCIWebSocketConnection: Sendable {
    func receive() async throws -> TCIWebSocketMessage
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

public struct TCIReadOnlySessionObservation: Equatable, Sendable {
    public let sequence: UInt64
    public let generation: UInt64
    public let availability: TCIReadOnlySessionAvailability
    public let snapshot: TCIAuthoritativeSnapshot?
    public let failure: TCIReadOnlySessionFailure?

    public init(
        sequence: UInt64,
        generation: UInt64,
        availability: TCIReadOnlySessionAvailability,
        snapshot: TCIAuthoritativeSnapshot?,
        failure: TCIReadOnlySessionFailure?
    ) {
        self.sequence = sequence
        self.generation = generation
        self.availability = availability
        self.snapshot = snapshot
        self.failure = failure
    }
}

/// Explicitly managed, read-only TCI WebSocket session. Every connection
/// generation starts with an empty decoder and reducer and must receive fresh
/// discovery plus READY before an authoritative snapshot is published.
public actor TCIReadOnlyWebSocketSession {
    public let endpoint: URL
    public let configuredAddress: TCIReceiverAddress

    private let connector: any TCIWebSocketConnecting
    private let limits: TCIProtocolLimits
    private let maximumBinaryMessageBytes: Int
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
    private var continuations: [UUID: AsyncStream<TCIReadOnlySessionObservation>.Continuation] = [:]

    public init(
        endpoint: URL,
        configuredAddress: TCIReceiverAddress,
        connector: any TCIWebSocketConnecting = NativeTCIWebSocketConnector(),
        limits: TCIProtocolLimits = .default,
        maximumBinaryMessageBytes: Int = 65_536
    ) {
        self.endpoint = endpoint
        self.configuredAddress = configuredAddress
        self.connector = connector
        self.limits = limits
        self.maximumBinaryMessageBytes = max(1, maximumBinaryMessageBytes)
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
        receiveTask = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let message = try await openedConnection.receive()
                    guard await self?.process(
                        message,
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

    private func process(
        _ message: TCIWebSocketMessage,
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
            reducer.apply(result)
            if let snapshot = reducer.authoritativeSnapshot(for: configuredAddress) {
                publish(availability: .available, snapshot: snapshot, failure: nil)
            } else {
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
            failure: failure
        )
        for continuation in continuations.values {
            continuation.yield(observationValue)
        }
    }

    private func removeContinuation(_ id: UUID) {
        continuations.removeValue(forKey: id)
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
