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

    public init(session: URLSession = .shared, maximumMessageBytes: Int = TCIIQFrame.maximumBytes) {
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
    /// Unattributed server-global telemetry; never configured control evidence.
    public let serverTransmitFrequency: TCIServerTransmitFrequencyObservation?
    /// Latest server click event; never configured evidence or a tuning readback.
    public let lastRXSpotClick: TCIRXSpotClickObservation?
    /// Unattributed legacy click event; never attributed to the configured receiver.
    public let lastLegacySpotClick: TCILegacySpotClickObservation?
    /// Server-window focus only; never configured evidence or local UI authority.
    public let serverAppFocus: TCIServerAppFocusObservation?
    /// Server event receipt only; never queue, TX start/completion, RF or CW authority.
    public let lastCWMacrosEmpty: TCICWMacrosEmptyObservation?
    /// Server callsign report only; never receiver/TX/RF or CW completion evidence.
    public let lastCallsignSend: TCICallsignSendObservation?
    /// Passive server locks by exact address; never tuning/control permission.
    public let vfoLocks: [TCIReceiverAddress: TCIVFOLockObservation]
    /// Raw per-address dBm tokens only; never readiness, calibration or authority.
    public let receiveChannelSensors: [TCIReceiverAddress: TCIRXChannelSensorsObservation]
    /// Deprecated receiver-only raw reports; never attributed to any channel.
    public let legacyReceiveSensors: [Int: TCILegacyRXSensorsObservation]
    /// Raw server tokens by TRX; never TX permission/activity or actual RF proof.
    public let transmitSensors: [Int: TCITXSensorsObservation]
    /// Independent global main-volume mute report; never configured/control evidence.
    public let serverMainMute: TCIServerMainMuteObservation?
    /// Independent receiver-wide mute reports; never per-channel/control evidence.
    public let receiverMutes: [Int: TCIReceiverMuteObservation]
    /// Independent global dB report; never audibility, streaming or control evidence.
    public let serverMainVolume: TCIServerMainVolumeObservation?
    /// Independent per-channel dB reports; never audibility, streaming or authority.
    public let receiverChannelVolumes: [TCIReceiverAddress: TCIReceiverChannelVolumeObservation]
    /// Independent balance dB reports; never measured stereo, streaming or authority.
    public let receiverChannelBalances: [TCIReceiverAddress: TCIReceiverChannelBalanceObservation]
    /// Independent monitor dB setting report; never monitor/TX activity or authority.
    public let serverMonitorVolume: TCIServerMonitorVolumeObservation?
    /// Independent monitoring-enable setting; never actual audio/TX activity or authority.
    public let serverMonitorEnable: TCIServerMonitorEnableObservation?
    /// Independent receiver AGC settings; never gain, audio or control evidence.
    public let receiverAGCModes: [Int: TCIReceiverAGCModeObservation]
    /// Independent raw receiver AGC gain settings; never mode/effect or authority.
    public let receiverAGCGains: [Int: TCIReceiverAGCGainObservation]
    /// Independent receiver NB settings; never capability, processing effect or authority.
    public let receiverNoiseBlankerEnables: [Int: TCIReceiverNoiseBlankerEnableObservation]
    /// Independent BIN setting reports; never capability, audio effect or authority.
    public let receiverBinauralEnables: [Int: TCIReceiverBinauralEnableObservation]
    /// Independent NR setting reports; never capability, audio effect or authority.
    public let receiverNoiseReductionEnables: [Int: TCIReceiverNoiseReductionEnableObservation]

    public init(
        sequence: UInt64,
        generation: UInt64,
        availability: TCIReadOnlySessionAvailability,
        snapshot: TCIAuthoritativeSnapshot?,
        failure: TCIReadOnlySessionFailure?,
        evidenceReceivedAt: Date? = nil,
        filterEvidenceSequence: UInt64 = 0,
        splitEvidenceReceivedAt: Date? = nil,
        serverTransmitFrequency: TCIServerTransmitFrequencyObservation? = nil,
        lastRXSpotClick: TCIRXSpotClickObservation? = nil,
        serverAppFocus: TCIServerAppFocusObservation? = nil,
        lastLegacySpotClick: TCILegacySpotClickObservation? = nil,
        lastCWMacrosEmpty: TCICWMacrosEmptyObservation? = nil,
        lastCallsignSend: TCICallsignSendObservation? = nil,
        vfoLocks: [TCIReceiverAddress: TCIVFOLockObservation] = [:],
        receiveChannelSensors: [TCIReceiverAddress: TCIRXChannelSensorsObservation] = [:],
        legacyReceiveSensors: [Int: TCILegacyRXSensorsObservation] = [:],
        transmitSensors: [Int: TCITXSensorsObservation] = [:],
        serverMainMute: TCIServerMainMuteObservation? = nil,
        receiverMutes: [Int: TCIReceiverMuteObservation] = [:],
        serverMainVolume: TCIServerMainVolumeObservation? = nil,
        receiverChannelVolumes: [TCIReceiverAddress: TCIReceiverChannelVolumeObservation] = [:],
        receiverChannelBalances: [TCIReceiverAddress: TCIReceiverChannelBalanceObservation] = [:],
        serverMonitorVolume: TCIServerMonitorVolumeObservation? = nil,
        serverMonitorEnable: TCIServerMonitorEnableObservation? = nil,
        receiverAGCModes: [Int: TCIReceiverAGCModeObservation] = [:],
        receiverAGCGains: [Int: TCIReceiverAGCGainObservation] = [:],
        receiverNoiseBlankerEnables: [Int: TCIReceiverNoiseBlankerEnableObservation] = [:],
        receiverBinauralEnables: [Int: TCIReceiverBinauralEnableObservation] = [:],
        receiverNoiseReductionEnables: [Int: TCIReceiverNoiseReductionEnableObservation] = [:]
    ) {
        self.sequence = sequence
        self.generation = generation
        self.availability = availability
        self.snapshot = snapshot
        self.failure = failure
        self.evidenceReceivedAt = evidenceReceivedAt
        self.filterEvidenceSequence = filterEvidenceSequence
        self.splitEvidenceReceivedAt = splitEvidenceReceivedAt
        self.serverTransmitFrequency = serverTransmitFrequency
        self.lastRXSpotClick = lastRXSpotClick
        self.serverAppFocus = serverAppFocus
        self.lastLegacySpotClick = lastLegacySpotClick
        self.lastCWMacrosEmpty = lastCWMacrosEmpty
        self.lastCallsignSend = lastCallsignSend
        self.vfoLocks = vfoLocks
        self.receiveChannelSensors = receiveChannelSensors
        self.legacyReceiveSensors = legacyReceiveSensors
        self.transmitSensors = transmitSensors
        self.serverMainMute = serverMainMute
        self.receiverMutes = receiverMutes
        self.serverMainVolume = serverMainVolume
        self.receiverChannelVolumes = receiverChannelVolumes
        self.receiverChannelBalances = receiverChannelBalances
        self.serverMonitorVolume = serverMonitorVolume
        self.serverMonitorEnable = serverMonitorEnable
        self.receiverAGCModes = receiverAGCModes
        self.receiverAGCGains = receiverAGCGains
        self.receiverNoiseBlankerEnables = receiverNoiseBlankerEnables
        self.receiverBinauralEnables = receiverBinauralEnables
        self.receiverNoiseReductionEnables = receiverNoiseReductionEnables
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
    private struct IQLease {
        let id: UUID
        let receiver: Int
        let rate: Int
        let continuation: AsyncThrowingStream<TCIIQBlock, Error>.Continuation
        let startedNS: UInt64
        var lastDataNS: UInt64?
        var capture: TCIIQCapture?
        var nextSequence: UInt64 = 0
        var nextSample: UInt64 = 0
        var readyAfterNS: UInt64 = 0
    }
    private var iqLeases: [Int: IQLease] = [:]
    private var iqEpoch: UInt64 = 0
    private var iqTimer: Task<Void, Never>?
    private var iqMutationInFlight = false
    private var iqCleanupInFlight = false
    private let monotonicClock: @Sendable () -> UInt64

    public init(
        endpoint: URL,
        configuredAddress: TCIReceiverAddress,
        connector: any TCIWebSocketConnecting = NativeTCIWebSocketConnector(),
        limits: TCIProtocolLimits = .default,
        maximumBinaryMessageBytes: Int = TCIIQFrame.maximumBytes,
        clock: @escaping @Sendable () -> Date = { Date() },
        monotonicClock: @escaping @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds }
    ) {
        self.endpoint = endpoint
        self.configuredAddress = configuredAddress
        self.connector = connector
        self.limits = limits
        self.maximumBinaryMessageBytes = max(1, maximumBinaryMessageBytes)
        self.clock = clock
        self.monotonicClock = monotonicClock
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
        iqTimer?.cancel()
        for lease in iqLeases.values { lease.continuation.finish(throwing: TCIIQSubscriptionError.stopped) }
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

    /// Sends one bounded TCI SPOT frame. Transport completion is an acceptance
    /// receipt only; TCI provides no authoritative display readback.
    public func addSpot(
        frequencyHz: Int64,
        callsign: String,
        mode: String,
        source: String,
        spotter: String,
        comment: String,
        colorHex: String,
        expectedGeneration: UInt64
    ) async throws {
        let validText: (String, Int, Bool) -> Bool = { text, maximum, required in
            (!required || !text.isEmpty) && text.utf8.count <= maximum &&
                !text.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        }
        guard validText(callsign, 32, true), validText(mode, 16, true),
              validText(source, 32, true), validText(spotter, 32, false),
              validText(comment, 96, false), colorHex.utf8.count == 7,
              colorHex.first == "#", let rgb = UInt32(colorHex.dropFirst(), radix: 16) else {
            throw TCITuneSessionError.invalidTarget
        }
        guard !commandInFlight else { throw TCITuneSessionError.commandInFlight }
        guard expectedGeneration == generation,
              observationValue.generation == generation,
              observationValue.availability == .available,
              let snapshot = observationValue.snapshot,
              let activeConnection = connection,
              let activeConnectionID = connectionID else { throw TCITuneSessionError.notReady }
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
            encoder = try TCICommandEncoder(trxCount: snapshot.trxCount, channelCount: snapshot.channelCount,
                                            frequencyRange: lower...upper,
                                            supportedModulations: Set(snapshot.supportedModulations), limits: limits)
        } catch { throw TCITuneSessionError.notReady }
        let rawText = [source, spotter, comment].filter { !$0.isEmpty }.joined(separator: " ")
        let safeText = String(rawText.unicodeScalars.map { scalar -> Character in
            let value = scalar.value
            return value >= 32 && value <= 126 && ![58, 44, 59].contains(value) ? Character(String(scalar)) : " "
        }.prefix(96))
        let frame: String
        do {
            frame = try encoder.encode(.spot(callsign: callsign, mode: mode,
                                             frequencyHz: frequencyHz,
                                             colorARGB: 0xFF00_0000 | rgb, text: safeText))
        } catch { throw TCITuneSessionError.invalidTarget }
        let activeGeneration = generation
        let activeRevision = lifecycleRevision
        commandInFlight = true
        defer { commandInFlight = false }
        do { try await activeConnection.send(text: frame) }
        catch {
            await fail(.transportClosed, connection: activeConnection, connectionID: activeConnectionID,
                       generation: activeGeneration, revision: activeRevision)
            throw TCITuneSessionError.transportClosed
        }
        guard generation == activeGeneration, lifecycleRevision == activeRevision,
              connectionID == activeConnectionID, connection != nil else {
            throw TCITuneSessionError.connectionChanged
        }
    }

    /// Sends the official callsign-scoped SPOT_DELETE frame. Transport completion
    /// is an acceptance receipt only; TCI provides no display readback.
    public func deleteSpot(callsign: String, expectedGeneration: UInt64) async throws {
        guard !callsign.isEmpty, callsign.utf8.count <= 32,
              !callsign.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else {
            throw TCITuneSessionError.invalidTarget
        }
        guard !commandInFlight else { throw TCITuneSessionError.commandInFlight }
        guard expectedGeneration == generation,
              observationValue.generation == generation,
              observationValue.availability == .available,
              let snapshot = observationValue.snapshot,
              let activeConnection = connection,
              let activeConnectionID = connectionID else { throw TCITuneSessionError.notReady }
        let lower = Int64(snapshot.vfoLimits.lower.rounded(.up))
        let upper = Int64(snapshot.vfoLimits.upper.rounded(.down))
        guard lower <= upper else { throw TCITuneSessionError.notReady }
        let encoder: TCICommandEncoder
        do {
            encoder = try TCICommandEncoder(trxCount: snapshot.trxCount, channelCount: snapshot.channelCount,
                                            frequencyRange: lower...upper,
                                            supportedModulations: Set(snapshot.supportedModulations), limits: limits)
        } catch { throw TCITuneSessionError.notReady }
        let frame: String
        do { frame = try encoder.encode(.deleteSpot(callsign: callsign)) }
        catch { throw TCITuneSessionError.invalidTarget }
        let activeGeneration = generation, activeRevision = lifecycleRevision
        commandInFlight = true
        defer { commandInFlight = false }
        do { try await activeConnection.send(text: frame) }
        catch {
            await fail(.transportClosed, connection: activeConnection, connectionID: activeConnectionID,
                       generation: activeGeneration, revision: activeRevision)
            throw TCITuneSessionError.transportClosed
        }
        guard generation == activeGeneration, lifecycleRevision == activeRevision,
              connectionID == activeConnectionID, connection != nil else {
            throw TCITuneSessionError.connectionChanged
        }
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
                if reducer.apply(command, receivedAt: receivedAt), isConfiguredEvidence(command) {
                    hasConfiguredEvidence = true
                    if command.name == "RX_FILTER_BAND" { filterEvidenceSequence = sequence + 1 }
                    if command.name == "SPLIT_ENABLE" { splitEvidenceReceivedAt = receivedAt }
                }
            }
            refreshIQCaptures()
            if let snapshot = reducer.authoritativeSnapshot(for: configuredAddress) {
                if hasConfiguredEvidence { evidenceReceivedAt = receivedAt }
                publish(availability: .available, snapshot: snapshot, failure: nil)
            } else {
                evidenceReceivedAt = nil
                publish(availability: .synchronizing, snapshot: nil, failure: nil)
            }
            return true

        case let .binary(value):
            // Audio and TX_CHRONO never enter the IQ path and never generate a
            // transmitter response. IQ faults retire only owned receive leases.
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
            await processIQ(value)
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
        finishIQ(.connectionChanged)
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
            splitEvidenceReceivedAt: splitEvidenceReceivedAt,
            serverTransmitFrequency: reducer.state.serverTransmitFrequency,
            lastRXSpotClick: reducer.state.lastRXSpotClick,
            serverAppFocus: reducer.state.serverAppFocus,
            lastLegacySpotClick: reducer.state.lastLegacySpotClick,
            lastCWMacrosEmpty: reducer.state.lastCWMacrosEmpty,
            lastCallsignSend: reducer.state.lastCallsignSend,
            vfoLocks: reducer.state.vfoLocks,
            receiveChannelSensors: reducer.state.receiveChannelSensors,
            legacyReceiveSensors: reducer.state.legacyReceiveSensors,
            transmitSensors: reducer.state.transmitSensors,
            serverMainMute: reducer.state.serverMainMute,
            receiverMutes: reducer.state.receiverMutes,
            serverMainVolume: reducer.state.serverMainVolume,
            receiverChannelVolumes: reducer.state.receiverChannelVolumes,
            receiverChannelBalances: reducer.state.receiverChannelBalances,
            serverMonitorVolume: reducer.state.serverMonitorVolume,
            serverMonitorEnable: reducer.state.serverMonitorEnable,
            receiverAGCModes: reducer.state.receiverAGCModes,
            receiverAGCGains: reducer.state.receiverAGCGains,
            receiverNoiseBlankerEnables: reducer.state.receiverNoiseBlankerEnables,
            receiverBinauralEnables: reducer.state.receiverBinauralEnables,
            receiverNoiseReductionEnables: reducer.state.receiverNoiseReductionEnables
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

extension TCIReadOnlyWebSocketSession {
    /// The supervisor rechecks this token before publishing asynchronous model
    /// output. TX, retune and Stop invalidate it before another IQ block arrives.
    public func currentIQCapture(leaseID:UUID) -> TCIIQCapture? {
        guard let lease=iqLeases.values.first(where:{$0.id == leaseID}), monotonicClock()>=lease.readyAfterNS else { return nil }
        return lease.capture
    }

    /// Leases only IQ on the existing control connection. Does not enable RX2,
    /// move DDS/VFO, select a radio or acquire transmit permissions.
    public func startIQ(receiver: Int, sampleRate: Int, expectedGeneration: UInt64) async throws -> TCIIQSubscription {
        guard !iqMutationInFlight, !iqCleanupInFlight, iqLeases[receiver] == nil else { throw TCIIQSubscriptionError.occupied }
        guard [48_000,96_000,192_000,384_000].contains(sampleRate),
              generation == expectedGeneration, observationValue.availability == .available,
              let active = connection, let id = connectionID,
              reducer.state.ready, let count = reducer.state.trxCount,
              receiver >= 0, receiver < min(count,2), reducer.state.ddsFrequencies[receiver] != nil,
              reducer.state.ifLimits != nil, reducer.state.transceivers[receiver]?.receiveEnabled == true,
              reducer.state.serverRunning != false else { throw TCIIQSubscriptionError.unavailable }
        guard let version = reducer.state.protocolAnnouncement.flatMap({ TCIVersion($0.version) }),
              version >= TCIVersion("1.8")!, version <= TCIVersion("2.1")! else { throw TCIIQSubscriptionError.unsupportedVersion }
        guard iqLeases.values.allSatisfy({$0.rate == sampleRate}) else { throw TCIIQSubscriptionError.rateConflict }
        let pair = AsyncThrowingStream<TCIIQBlock, Error>.makeStream(bufferingPolicy: .bufferingOldest(2))
        let leaseID = UUID()
        pair.continuation.onTermination = { [weak self] _ in
            Task { await self?.stopIQ(leaseID: leaseID) }
        }
        iqLeases[receiver] = IQLease(id:leaseID,receiver:receiver,rate:sampleRate,continuation:pair.continuation,
                                     startedNS:monotonicClock())
        iqMutationInFlight = true
        defer { iqMutationInFlight = false }
        do {
            if iqLeases.count == 1 { try await active.send(text:"iq_samplerate:\(sampleRate);") }
            guard connectionID == id, generation == expectedGeneration, iqLeases[receiver]?.id == leaseID else {
                throw TCIIQSubscriptionError.connectionChanged
            }
            try await active.send(text:"iq_start:\(receiver);")
            guard connectionID == id, generation == expectedGeneration, iqLeases[receiver]?.id == leaseID else {
                throw TCIIQSubscriptionError.connectionChanged
            }
            refreshIQCaptures()
            if iqTimer == nil {
                iqTimer = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds:250_000_000)
                        if Task.isCancelled { return }
                        await self?.checkIQTimeouts()
                    }
                }
            }
            return TCIIQSubscription(leaseID:leaseID,receiver:receiver,blocks:pair.stream)
        } catch {
            if iqLeases[receiver]?.id == leaseID {
                iqLeases.removeValue(forKey:receiver)?.continuation.finish(throwing:TCIIQSubscriptionError.connectionChanged)
                if connectionID == id { try? await active.send(text:"iq_stop:\(receiver);") }
            }
            throw error
        }
    }

    public func stopIQ(leaseID: UUID) async {
        guard let receiver=iqLeases.first(where:{$0.value.id == leaseID})?.key else { return }
        let lease=iqLeases.removeValue(forKey:receiver)
        lease?.continuation.finish()
        if iqLeases.isEmpty { iqTimer?.cancel(); iqTimer=nil }
        // The transport belongs to CAT; Stop releases only this IQ receiver.
        try? await connection?.send(text:"iq_stop:\(receiver);")
    }

    private func finishIQ(_ error: TCIIQSubscriptionError) {
        iqTimer?.cancel(); iqTimer=nil
        let old=iqLeases; iqLeases.removeAll()
        for lease in old.values { lease.continuation.finish(throwing:error) }
    }

    private func refreshIQCaptures() {
        let now=monotonicClock(), state=reducer.state
        let rigRX: Bool = state.trxCount.map { count in
            (0..<count).allSatisfy{state.transceivers[$0]?.transmitting == false && state.transceivers[$0]?.tuning == false}
        } ?? false
        for receiver in Array(iqLeases.keys) {
            guard var lease=iqLeases[receiver] else { continue }
            guard state.ready, rigRX, state.serverRunning != false,
                  state.transceivers[receiver]?.receiveEnabled == true,
                  let centre=state.ddsFrequencies[receiver], let limits=state.ifLimits,
                  let device=state.device, let protocolVersion=state.protocolAnnouncement?.version else {
                lease.capture=nil; lease.readyAfterNS=now+500_000_000; iqLeases[receiver]=lease; continue
            }
            let lower=max(limits.lower,-Double(lease.rate)/2), upper=min(limits.upper,Double(lease.rate)/2)
            guard lower < upper else { lease.capture=nil; iqLeases[receiver]=lease; continue }
            let old=lease.capture
            if old?.centreHz != centre || old?.sampleRate != lease.rate || old?.lowerOffsetHz != lower || old?.upperOffsetHz != upper ||
                old?.device != device || old?.protocolVersion != protocolVersion {
                guard iqEpoch < UInt64.max else { finishIQ(.connectionChanged); return }
                iqEpoch += 1
                lease.capture=TCIIQCapture(streamToken:UUID(),epoch:iqEpoch,connectionGeneration:generation,
                    receiver:receiver,device:device,protocolVersion:protocolVersion,centreHz:centre,sampleRate:lease.rate,
                    lowerOffsetHz:lower,upperOffsetHz:upper)
                lease.nextSample=0; lease.nextSequence=0; lease.readyAfterNS=now+500_000_000
                iqLeases[receiver]=lease
            }
        }
    }

    private func processIQ(_ bytes: Data) async {
        guard !iqLeases.isEmpty else { return }
        let frame: TCIIQFrame
        do {
            guard let parsed=try TCIIQFrame.parse(bytes,protocolVersion:reducer.state.protocolAnnouncement.flatMap{TCIVersion($0.version)}) else { return }
            frame=parsed
        } catch {
            // A malformed IQ frame has no trustworthy receiver identity. Retire
            // the selected IQ leases without affecting the text/control owner.
            await retireIQ(.invalidFrame); return
        }
        guard var lease=iqLeases[frame.receiver] else { return }
        let now=monotonicClock()
        lease.lastDataNS=now; iqLeases[frame.receiver]=lease
        guard frame.sampleRate == lease.rate, frame.complexSampleCount <= lease.rate/8 else {
            await retireIQ(.invalidFrame,receiver:frame.receiver); return
        }
        guard let capture=lease.capture, now>=lease.readyAfterNS else { return }
        guard lease.nextSequence < UInt64.max, UInt64(frame.complexSampleCount) <= UInt64.max-lease.nextSample else {
            await retireIQ(.invalidFrame,receiver:frame.receiver); return
        }
        let block=TCIIQBlock(capture:capture,sequence:lease.nextSequence,firstSample:lease.nextSample,
                             receivedMonotonicNS:now,frame:frame)
        lease.nextSequence += 1; lease.nextSample += UInt64(frame.complexSampleCount)
        iqLeases[frame.receiver]=lease
        switch lease.continuation.yield(block) {
        case .dropped: await retireIQ(.overflow,receiver:frame.receiver)
        case .terminated: await stopIQ(leaseID:lease.id)
        case .enqueued: break
        @unknown default: await retireIQ(.overflow,receiver:frame.receiver)
        }
    }

    private func retireIQ(_ error:TCIIQSubscriptionError,receiver:Int? = nil) async {
        let receivers=receiver.map{[$0]} ?? Array(iqLeases.keys), active=connection, id=connectionID
        for receiver in receivers { iqLeases.removeValue(forKey:receiver)?.continuation.finish(throwing:error) }
        if iqLeases.isEmpty { iqTimer?.cancel(); iqTimer=nil }
        iqCleanupInFlight=true
        defer { iqCleanupInFlight=false }
        for receiver in receivers {
            guard connectionID == id else { return }
            try? await active?.send(text:"iq_stop:\(receiver);")
        }
    }

    private func checkIQTimeouts() async {
        let active=connection, id=connectionID
        for receiver in Array(iqLeases.keys) {
            guard connectionID == id else { return }
            let now=monotonicClock()
            guard let lease=iqLeases[receiver] else { continue }
            let last=lease.lastDataNS ?? lease.startedNS
            let budget:UInt64=lease.lastDataNS == nil ? 5_000_000_000 : 2_000_000_000
            guard now<last || now-last>budget else { continue }
            iqLeases.removeValue(forKey:receiver)?.continuation.finish(throwing:lease.lastDataNS == nil ?
                TCIIQSubscriptionError.noData : TCIIQSubscriptionError.stalled)
            guard connectionID == id else { return }
            try? await active?.send(text:"iq_stop:\(receiver);")
        }
        if iqLeases.isEmpty { iqTimer?.cancel(); iqTimer=nil }
    }
}
