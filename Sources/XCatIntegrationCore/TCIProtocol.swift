// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import Foundation

public struct TCIProtocolLimits: Equatable, Sendable {
    public let maximumFrameBytes: Int
    public let maximumAccumulatorBytes: Int
    public let maximumCommandsPerFeed: Int
    public let maximumCommandBytes: Int
    public let maximumCommandNameBytes: Int
    public let maximumArguments: Int
    public let maximumArgumentBytes: Int
    public let maximumDiagnostics: Int
    public let maximumUnknownCommands: Int
    public let maximumTRXCount: Int
    public let maximumChannelCount: Int
    public let maximumFrequencyHz: Int64

    public init(
        maximumFrameBytes: Int = 65_536,
        maximumAccumulatorBytes: Int = 65_536,
        maximumCommandsPerFeed: Int = 256,
        maximumCommandBytes: Int = 4_096,
        maximumCommandNameBytes: Int = 64,
        maximumArguments: Int = 64,
        maximumArgumentBytes: Int = 1_024,
        maximumDiagnostics: Int = 32,
        maximumUnknownCommands: Int = 16,
        maximumTRXCount: Int = 16,
        maximumChannelCount: Int = 16,
        maximumFrequencyHz: Int64 = 1_000_000_000_000
    ) {
        self.maximumFrameBytes = max(1, maximumFrameBytes)
        self.maximumAccumulatorBytes = max(1, maximumAccumulatorBytes)
        self.maximumCommandsPerFeed = max(1, maximumCommandsPerFeed)
        self.maximumCommandBytes = max(1, maximumCommandBytes)
        self.maximumCommandNameBytes = max(1, maximumCommandNameBytes)
        self.maximumArguments = max(1, maximumArguments)
        self.maximumArgumentBytes = max(1, maximumArgumentBytes)
        self.maximumDiagnostics = max(1, maximumDiagnostics)
        self.maximumUnknownCommands = max(1, maximumUnknownCommands)
        self.maximumTRXCount = max(1, maximumTRXCount)
        self.maximumChannelCount = max(1, maximumChannelCount)
        self.maximumFrequencyHz = max(1, maximumFrequencyHz)
    }

    public static let `default` = TCIProtocolLimits()
}

public enum TCIDiagnosticKind: String, Equatable, Sendable {
    case frameTooLarge
    case accumulatorTooLarge
    case tooManyCommands
    case commandTooLarge
    case invalidASCII
    case invalidCommandName
    case tooManyArguments
    case argumentTooLarge
    case invalidArguments
    case outOfBounds
    case unknownCommand
}

public struct TCIDiagnostic: Error, Equatable, Sendable {
    public let kind: TCIDiagnosticKind
    public let commandName: String?

    public init(kind: TCIDiagnosticKind, commandName: String? = nil) {
        self.kind = kind
        self.commandName = commandName
    }
}

public struct TCICommand: Equatable, Sendable {
    /// Uppercase ASCII command name. TCI command names are case-insensitive.
    public let name: String
    /// Arguments retain their positions, including empty arguments.
    public let arguments: [String]

    public init(name: String, arguments: [String]) {
        self.name = name.uppercased()
        self.arguments = arguments
    }
}

/// Official TRX signal sources (TCI 2.0, ExpertSDR3/TCI b081213f, page 16).
/// Selecting TCI audio does not enable its stream; that is a separate operation.
public enum TCITXSignalSource: String, CaseIterable, Sendable {
    case tci
    case microphone1 = "mic1"
    case microphone2 = "mic2"
    case pcMicrophone = "micPC"
    case eCoder2 = "ecoder2"
}

/// A closed outbound vocabulary, not a transport or permission to transmit.
/// TX_ENABLE is a server permission report, and has no outbound setter here.
public enum TCIOutboundCommand: Equatable, Sendable {
    case setVFO(address: TCIReceiverAddress, frequencyHz: Int64)
    case readVFO(address: TCIReceiverAddress)
    case setModulation(trx: Int, mode: String)
    case readModulation(trx: Int)
    case setRXFilterBand(trx: Int, lowerHz: Int64, upperHz: Int64)
    case readRXFilterBand(trx: Int)
    case setSplitEnable(trx: Int, enabled: Bool)
    case readSplitEnable(trx: Int)
    case setRXChannelEnable(address: TCIReceiverAddress, enabled: Bool)
    case readRXChannelEnable(address: TCIReceiverAddress)
    case setTRX(trx: Int, enabled: Bool, source: TCITXSignalSource? = nil)
    case readTRX(trx: Int)
    case setTune(trx: Int, enabled: Bool)
    case readTune(trx: Int)
    case spot(callsign: String, mode: String, frequencyHz: Int64, colorARGB: UInt32, text: String)
    case deleteSpot(callsign: String)
    case clearSpots
}

public enum TCICommandEncodingError: Error, Equatable, Sendable {
    case invalidConfiguration
    case outOfBounds
    case invalidArgument
    case unsupportedModulation
    case argumentTooLarge
    case tooManyArguments
    case commandTooLarge
    case frameTooLarge
}

/// Pure, bounded encoder for the official ASCII grammar. Discovery values must
/// be supplied explicitly. Callers still own readiness, freshness, TX permission,
/// source ownership, and version/capability admission; encoding grants none.
public struct TCICommandEncoder: Sendable {
    public let limits: TCIProtocolLimits
    public let trxCount: Int
    public let channelCount: Int
    public let frequencyRange: ClosedRange<Int64>
    public let supportedModulations: Set<String>

    public init(
        trxCount: Int,
        channelCount: Int,
        frequencyRange: ClosedRange<Int64>,
        supportedModulations: Set<String>,
        limits: TCIProtocolLimits = .default
    ) throws {
        guard trxCount > 0, trxCount <= limits.maximumTRXCount,
              channelCount > 0, channelCount <= limits.maximumChannelCount,
              frequencyRange.lowerBound >= 0,
              frequencyRange.upperBound <= limits.maximumFrequencyHz,
              !supportedModulations.isEmpty,
              supportedModulations.count <= limits.maximumArguments
        else { throw TCICommandEncodingError.invalidConfiguration }
        var modes: Set<String> = []
        for mode in supportedModulations {
            try Self.validateArgument(mode, token: true, limits: limits)
            modes.insert(mode.uppercased())
        }
        self.limits = limits
        self.trxCount = trxCount
        self.channelCount = channelCount
        self.frequencyRange = frequencyRange
        self.supportedModulations = modes
    }

    public func encode(_ command: TCIOutboundCommand) throws -> String {
        let name: String
        var arguments: [String]
        switch command {
        case let .setVFO(address, frequencyHz):
            try validateAddress(address)
            guard frequencyRange.contains(frequencyHz) else { throw TCICommandEncodingError.outOfBounds }
            name = "VFO"; arguments = [String(address.trx), String(address.channel), String(frequencyHz)]
        case let .readVFO(address):
            try validateAddress(address)
            name = "VFO"; arguments = [String(address.trx), String(address.channel)]
        case let .setModulation(trx, mode):
            try validateTRX(trx)
            try Self.validateArgument(mode, token: true, limits: limits)
            let normalizedMode = mode.uppercased()
            guard supportedModulations.contains(normalizedMode) else {
                throw TCICommandEncodingError.unsupportedModulation
            }
            name = "MODULATION"; arguments = [String(trx), normalizedMode]
        case let .readModulation(trx):
            try validateTRX(trx)
            name = "MODULATION"; arguments = [String(trx)]
        case let .setRXFilterBand(trx, lowerHz, upperHz):
            try validateTRX(trx)
            // IF_LIMITS describes VFO-A IF tuning, not RX filter bandwidth.
            guard lowerHz < upperHz, lowerHz >= -limits.maximumFrequencyHz,
                  upperHz <= limits.maximumFrequencyHz else { throw TCICommandEncodingError.outOfBounds }
            name = "RX_FILTER_BAND"; arguments = [String(trx), String(lowerHz), String(upperHz)]
        case let .readRXFilterBand(trx):
            try validateTRX(trx)
            name = "RX_FILTER_BAND"; arguments = [String(trx)]
        case let .setSplitEnable(trx, enabled):
            try validateTRX(trx)
            name = "SPLIT_ENABLE"; arguments = [String(trx), String(enabled)]
        case let .readSplitEnable(trx):
            try validateTRX(trx)
            name = "SPLIT_ENABLE"; arguments = [String(trx)]
        case let .setRXChannelEnable(address, enabled):
            try validateAddress(address)
            // Page 19: channel A is always on; only B can be controlled.
            guard address.channel == 1 else { throw TCICommandEncodingError.outOfBounds }
            name = "RX_CHANNEL_ENABLE"; arguments = [String(address.trx), String(address.channel), String(enabled)]
        case let .readRXChannelEnable(address):
            try validateAddress(address)
            name = "RX_CHANNEL_ENABLE"; arguments = [String(address.trx), String(address.channel)]
        case let .setTRX(trx, enabled, source):
            try validateTRX(trx)
            name = "TRX"; arguments = [String(trx), String(enabled)]
            if let source { arguments.append(source.rawValue) }
        case let .readTRX(trx):
            try validateTRX(trx)
            name = "TRX"; arguments = [String(trx)]
        case let .setTune(trx, enabled):
            try validateTRX(trx)
            name = "TUNE"; arguments = [String(trx), String(enabled)]
        case let .readTune(trx):
            try validateTRX(trx)
            name = "TUNE"; arguments = [String(trx)]
        case let .spot(callsign, mode, frequencyHz, colorARGB, text):
            try Self.validateArgument(callsign, token: true, limits: limits)
            try Self.validateArgument(mode, token: true, limits: limits)
            guard frequencyHz > 0, frequencyHz <= limits.maximumFrequencyHz else {
                throw TCICommandEncodingError.outOfBounds
            }
            name = "SPOT"; arguments = [callsign, mode.uppercased(), String(frequencyHz), String(colorARGB), text]
        case let .deleteSpot(callsign):
            try Self.validateArgument(callsign, token: true, limits: limits)
            name = "SPOT_DELETE"; arguments = [callsign]
        case .clearSpots:
            name = "SPOT_CLEAR"; arguments = []
        }
        guard arguments.count <= limits.maximumArguments else { throw TCICommandEncodingError.tooManyArguments }
        for argument in arguments {
            try Self.validateArgument(argument, token: false, limits: limits)
        }
        guard name.utf8.count <= limits.maximumCommandNameBytes else {
            throw TCICommandEncodingError.commandTooLarge
        }
        // All pieces are bounded before concatenation, including arbitrary text.
        let body = name + (arguments.isEmpty ? "" : ":" + arguments.joined(separator: ","))
        guard body.utf8.count <= limits.maximumCommandBytes else { throw TCICommandEncodingError.commandTooLarge }
        guard body.utf8.count < limits.maximumFrameBytes,
              body.utf8.count < limits.maximumAccumulatorBytes else { throw TCICommandEncodingError.frameTooLarge }
        return body + ";"
    }

    /// Encodes one explicit transport frame without weakening the per-command
    /// bounds. Callers retain command authority and readback ownership.
    public func encodeFrame(_ commands: [TCIOutboundCommand]) throws -> String {
        guard !commands.isEmpty else { throw TCICommandEncodingError.invalidArgument }
        guard commands.count <= limits.maximumCommandsPerFeed else {
            throw TCICommandEncodingError.tooManyArguments
        }
        var frame = ""
        for command in commands {
            frame += try encode(command)
            guard frame.utf8.count <= limits.maximumFrameBytes,
                  frame.utf8.count <= limits.maximumAccumulatorBytes else {
                throw TCICommandEncodingError.frameTooLarge
            }
        }
        return frame
    }

    private func validateTRX(_ trx: Int) throws {
        guard trx >= 0, trx < trxCount else { throw TCICommandEncodingError.outOfBounds }
    }

    private func validateAddress(_ address: TCIReceiverAddress) throws {
        try validateTRX(address.trx)
        guard address.channel >= 0, address.channel < channelCount else {
            throw TCICommandEncodingError.outOfBounds
        }
    }

    private static func validateArgument(_ value: String, token: Bool, limits: TCIProtocolLimits) throws {
        guard value.utf8.count <= limits.maximumArgumentBytes else { throw TCICommandEncodingError.argumentTooLarge }
        guard (!token || !value.isEmpty), value.utf8.allSatisfy({ byte in
            byte >= (token ? 33 : 32) && byte <= 126 && byte != 58 && byte != 44 && byte != 59
        }) else { throw TCICommandEncodingError.invalidArgument }
    }
}

public struct TCITextDecodeResult: Equatable, Sendable {
    public let commands: [TCICommand]
    public let diagnostics: [TCIDiagnostic]

    public init(commands: [TCICommand], diagnostics: [TCIDiagnostic]) {
        self.commands = commands
        self.diagnostics = diagnostics
    }
}

/// Bounded incremental decoder for the ASCII command stream carried in TCI
/// WebSocket text messages. It deliberately has no transport dependency.
public struct TCITextDecoder: Sendable {
    public let limits: TCIProtocolLimits
    private var accumulator = ""

    public init(limits: TCIProtocolLimits = .default) {
        self.limits = limits
    }

    public var bufferedByteCount: Int { accumulator.utf8.count }

    public mutating func reset() {
        accumulator.removeAll(keepingCapacity: false)
    }

    public mutating func feed(_ fragment: String) -> TCITextDecodeResult {
        var diagnostics: [TCIDiagnostic] = []
        let frameBytes = fragment.utf8.count
        guard frameBytes <= limits.maximumFrameBytes else {
            reset()
            diagnostics.append(TCIDiagnostic(kind: .frameTooLarge))
            return TCITextDecodeResult(commands: [], diagnostics: diagnostics)
        }
        guard fragment.utf8.allSatisfy(Self.isPermittedTextByte) else {
            reset()
            diagnostics.append(TCIDiagnostic(kind: .invalidASCII))
            return TCITextDecodeResult(commands: [], diagnostics: diagnostics)
        }
        guard frameBytes <= limits.maximumAccumulatorBytes - accumulator.utf8.count else {
            reset()
            diagnostics.append(TCIDiagnostic(kind: .accumulatorTooLarge))
            return TCITextDecodeResult(commands: [], diagnostics: diagnostics)
        }

        accumulator.append(fragment)
        var commands: [TCICommand] = []
        var processedCommandCount = 0
        while let terminator = accumulator.firstIndex(of: ";") {
            let raw = String(accumulator[..<terminator])
            accumulator.removeSubrange(...terminator)
            guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            if processedCommandCount == limits.maximumCommandsPerFeed {
                reset()
                appendBounded(TCIDiagnostic(kind: .tooManyCommands), to: &diagnostics)
                return TCITextDecodeResult(commands: commands, diagnostics: diagnostics)
            }
            processedCommandCount += 1
            guard raw.utf8.count <= limits.maximumCommandBytes else {
                appendBounded(TCIDiagnostic(kind: .commandTooLarge), to: &diagnostics)
                continue
            }

            switch Self.decodeCommand(raw, limits: limits) {
            case let .success(command):
                commands.append(command)
            case let .failure(diagnostic):
                appendBounded(diagnostic, to: &diagnostics)
            }
        }

        if accumulator.utf8.count > limits.maximumAccumulatorBytes {
            reset()
            appendBounded(TCIDiagnostic(kind: .accumulatorTooLarge), to: &diagnostics)
        }
        return TCITextDecodeResult(commands: commands, diagnostics: diagnostics)
    }

    private func appendBounded(_ diagnostic: TCIDiagnostic, to diagnostics: inout [TCIDiagnostic]) {
        diagnostics.append(diagnostic)
        if diagnostics.count > limits.maximumDiagnostics {
            diagnostics.removeFirst(diagnostics.count - limits.maximumDiagnostics)
        }
    }

    private static func decodeCommand(
        _ raw: String,
        limits: TCIProtocolLimits
    ) -> Result<TCICommand, TCIDiagnostic> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let separator = trimmed.firstIndex(of: ":")
        let rawName = separator.map { String(trimmed[..<$0]) } ?? trimmed
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !name.isEmpty,
              name.utf8.count <= limits.maximumCommandNameBytes,
              name.utf8.allSatisfy(Self.isCommandNameByte)
        else {
            return .failure(TCIDiagnostic(kind: .invalidCommandName))
        }

        guard let separator else {
            return .success(TCICommand(name: name, arguments: []))
        }
        let argumentStart = trimmed.index(after: separator)
        let rawArguments = String(trimmed[argumentStart...])
        guard !rawArguments.contains(":") else {
            return .failure(TCIDiagnostic(kind: .invalidArguments, commandName: name))
        }
        let arguments = rawArguments.isEmpty
            ? [""]
            : rawArguments
                .split(separator: ",", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard arguments.count <= limits.maximumArguments else {
            return .failure(TCIDiagnostic(kind: .tooManyArguments, commandName: name))
        }
        guard arguments.allSatisfy({ $0.utf8.count <= limits.maximumArgumentBytes }) else {
            return .failure(TCIDiagnostic(kind: .argumentTooLarge, commandName: name))
        }
        return .success(TCICommand(name: name, arguments: arguments))
    }

    private static func isCommandNameByte(_ byte: UInt8) -> Bool {
        (byte >= 65 && byte <= 90) || (byte >= 48 && byte <= 57) || byte == 95
    }

    private static func isPermittedTextByte(_ byte: UInt8) -> Bool {
        byte == 9 || byte == 10 || byte == 13 || (byte >= 32 && byte <= 126)
    }
}

public enum TCIValueParser {
    public static func integer(_ value: String) -> Int? {
        guard isDecimalInteger(value), let parsed = Int(value) else { return nil }
        return parsed
    }

    public static func integer64(_ value: String) -> Int64? {
        guard isDecimalInteger(value), let parsed = Int64(value) else { return nil }
        return parsed
    }

    public static func finiteDouble(_ value: String) -> Double? {
        guard isDecimalNumber(value), let parsed = Double(value), parsed.isFinite else { return nil }
        return parsed
    }

    /// Application syntax/size policy: [+-]?[0-9]+(\.[0-9]+)?. Returns the
    /// original token without numeric conversion or a physical-range claim.
    public static func boundedDecimalToken(_ value: String, maximumBytes: Int) -> String? {
        guard value.utf8.count <= maximumBytes, isDecimalNumber(value) else { return nil }
        let bytes = value.utf8
        let digits = (bytes.first == 43 || bytes.first == 45) ? bytes.dropFirst() : bytes[...]
        guard let first = digits.first, first >= 48, first <= 57,
              let last = digits.last, last >= 48, last <= 57 else { return nil }
        return value
    }

    public static func boolean(_ value: String) -> Bool? {
        switch value.lowercased() {
        case "true": true
        case "false": false
        default: nil
        }
    }

    private static func isDecimalInteger(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard !bytes.isEmpty else { return false }
        let start = (bytes[0] == 43 || bytes[0] == 45) ? 1 : 0
        guard start < bytes.count else { return false }
        return bytes[start...].allSatisfy { $0 >= 48 && $0 <= 57 }
    }

    private static func isDecimalNumber(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard !bytes.isEmpty else { return false }
        var index = (bytes[0] == 43 || bytes[0] == 45) ? 1 : 0
        guard index < bytes.count else { return false }
        var digitCount = 0
        var dotCount = 0
        while index < bytes.count {
            let byte = bytes[index]
            if byte >= 48 && byte <= 57 {
                digitCount += 1
            } else if byte == 46 {
                dotCount += 1
                if dotCount > 1 { return false }
            } else {
                return false
            }
            index += 1
        }
        return digitCount > 0
    }
}

public struct TCIReceiverAddress: Hashable, Sendable {
    public let trx: Int
    public let channel: Int

    public init(trx: Int, channel: Int) {
        self.trx = trx
        self.channel = channel
    }
}

public struct TCINumericRange: Equatable, Sendable {
    public let lower: Double
    public let upper: Double

    public init(lower: Double, upper: Double) {
        self.lower = lower
        self.upper = upper
    }

    public func contains(_ value: Double) -> Bool {
        value >= lower && value <= upper
    }
}

public struct TCIFilterBand: Equatable, Sendable {
    public let lowHz: Int64
    public let highHz: Int64

    public init(lowHz: Int64, highHz: Int64) {
        self.lowHz = lowHz
        self.highHz = highHz
    }
}

public struct TCIProtocolAnnouncement: Equatable, Sendable {
    public let program: String
    public let version: String

    public init(program: String, version: String) {
        self.program = program
        self.version = version
    }
}

public struct TCITransceiverState: Equatable, Sendable {
    public var modulation: String?
    public var receiveFilter: TCIFilterBand?
    public var splitEnabled: Bool?
    public var receiveEnabled: Bool?
    public var transmitEnabled: Bool?
    public var transmitting: Bool?
    public var transmitSignalSource: String?
    public var tuning: Bool?

    public init(
        modulation: String? = nil,
        receiveFilter: TCIFilterBand? = nil,
        splitEnabled: Bool? = nil,
        receiveEnabled: Bool? = nil,
        transmitEnabled: Bool? = nil,
        transmitting: Bool? = nil,
        transmitSignalSource: String? = nil,
        tuning: Bool? = nil
    ) {
        self.modulation = modulation
        self.receiveFilter = receiveFilter
        self.splitEnabled = splitEnabled
        self.receiveEnabled = receiveEnabled
        self.transmitEnabled = transmitEnabled
        self.transmitting = transmitting
        self.transmitSignalSource = transmitSignalSource
        self.tuning = tuning
    }
}

public struct TCIAuthoritativeSnapshot: Equatable, Sendable {
    public let address: TCIReceiverAddress
    public let protocolAnnouncement: TCIProtocolAnnouncement
    public let device: String
    public let receiveOnly: Bool
    public let trxCount: Int
    public let channelCount: Int
    public let vfoLimits: TCINumericRange
    public let ifLimits: TCINumericRange
    public let supportedModulations: [String]
    public let serverRunning: Bool?
    public let frequencyHz: Int64
    public let transceiver: TCITransceiverState

    public init(
        address: TCIReceiverAddress,
        protocolAnnouncement: TCIProtocolAnnouncement,
        device: String,
        receiveOnly: Bool,
        trxCount: Int,
        channelCount: Int,
        vfoLimits: TCINumericRange,
        ifLimits: TCINumericRange,
        supportedModulations: [String],
        serverRunning: Bool?,
        frequencyHz: Int64,
        transceiver: TCITransceiverState
    ) {
        self.address = address
        self.protocolAnnouncement = protocolAnnouncement
        self.device = device
        self.receiveOnly = receiveOnly
        self.trxCount = trxCount
        self.channelCount = channelCount
        self.vfoLimits = vfoLimits
        self.ifLimits = ifLimits
        self.supportedModulations = supportedModulations
        self.serverRunning = serverRunning
        self.frequencyHz = frequencyHz
        self.transceiver = transceiver
    }
}

/// Server-global notification from pinned TCI b081213f, page 37. The wire
/// command carries no TRX, channel or VFO identity, nor a server timestamp.
public struct TCIServerTransmitFrequencyObservation: Equatable, Sendable {
    public let frequencyHz: Int64
    /// Local producer receipt time; nil means no timed receipt was supplied.
    /// Retaining this value does not establish freshness or transmit authority.
    public let receivedAt: Date?
}

/// Latest server click notification (pinned TCI b081213f, pages 36–37).
/// This is an event receipt, not retained spot inventory or a tuning readback.
public struct TCIRXSpotClickObservation: Equatable, Sendable {
    public let address: TCIReceiverAddress
    public let callsign: String
    public let frequencyHz: Int64
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Legacy server click event (pinned TCI b081213f, page 36).
/// The wire carries no receiver/channel identity, mode, or tuning confirmation.
public struct TCILegacySpotClickObservation: Equatable, Sendable {
    public let callsign: String
    public let frequencyHz: Int64
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Focus of the server's ExpertSDR3 window (pinned TCI b081213f, page 37).
/// It has no receiver identity and confers no local application/control authority.
public struct TCIServerAppFocusObservation: Equatable, Sendable {
    public let isFocused: Bool
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Receipt of CW_MACROS_EMPTY (pinned TCI b081213f, page 7, section 3.2.1).
/// The server sends it when the last queued letter starts transmission in
/// terminal mode. Receipt does not prove an empty queue, successful transmission
/// start/completion, RF output/delivery, terminal state, or any receiver state,
/// and grants no CW or control authority.
public struct TCICWMacrosEmptyObservation: Equatable, Sendable {
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Server-reported final callsign from CALLSIGN_SEND (pinned TCI b081213f,
/// page 8, section 3.2.2). No receiver, command correlation or server time is
/// supplied. Receipt proves no TX success/completion or RF delivery, establishes
/// no target/contact identity, grants no CW/control authority, and must not
/// change transmit state or configured evidence.
public struct TCICallsignSendObservation: Equatable, Sendable {
    public let callsign: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Server-reported receiver/channel tuning lock (pinned TCI b081213f, page 40).
/// The report identifies no owning client, duration or command correlation.
/// Neither locked nor unlocked grants tuning/control authority or confirms tuning.
public struct TCIVFOLockObservation: Equatable, Sendable {
    public let isLocked: Bool
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Raw RX_CHANNEL_SENSORS report (pinned TCI b081213f, page 40): signal level
/// in dBm at an exact receiver/channel. The specification defines no numeric
/// range or sentinel. This retains a bounded decimal token, not a calibrated
/// S-meter/quality assessment, readiness, station freshness or control authority.
public struct TCIRXChannelSensorsObservation: Equatable, Sendable {
    public let rawDBm: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Deprecated server-only RX_SENSORS report (pinned TCI b081213f, page 39).
/// The wire identifies only a receiver, never a channel. Raw bounded dBm
/// syntax grants no physical-range, calibration, readiness, freshness, control
/// or RF inference; it must not replace RX_CHANNEL_SENSORS evidence.
public struct TCILegacyRXSensorsObservation: Equatable, Sendable {
    public let rawDBm: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Raw server TX_SENSORS tokens (pinned TCI b081213f, pages 39–40).
/// The formal contract has five arguments despite the malformed printed example.
/// No physical ranges/sentinels are specified. Receipt grants no TX permission,
/// activity/completion, control authority, calibration or actual RF-output proof.
public struct TCITXSensorsObservation: Equatable, Sendable {
    public let rawMicrophoneDBm: String
    public let rawRMSWatts: String
    public let rawPeakWatts: String
    public let rawSWR: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive server MUTE reply/broadcast (pinned TCI b081213f, pages 21–22).
/// Reports global main-volume mute, not an individual receiver/channel or local
/// OS audio state. Neither value grants mute/control authority or radio readiness.
public struct TCIServerMainMuteObservation: Equatable, Sendable {
    public let isMuted: Bool
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive RX_MUTE server reply/broadcast (pinned TCI b081213f, page 22).
/// Applies to one receiver, not an individual channel or the global MUTE state.
/// Neither value establishes readiness, audio/RF delivery or control authority.
public struct TCIReceiverMuteObservation: Equatable, Sendable {
    public let isMuted: Bool
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive global VOLUME reply/broadcast (pinned TCI b081213f, page 21).
/// Retains the decimal dB token within the official [-60, 0] range. This is
/// neither per-receiver volume nor mute, audibility, local playback/streaming,
/// readiness or control authority, and provides no tune/TX/RF evidence.
public struct TCIServerMainVolumeObservation: Equatable, Sendable {
    public let rawDB: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive RX_VOLUME server reply/broadcast (pinned TCI b081213f, page 22).
/// Per receiver/channel dB within [-60, 0]; channel identity follows discovery
/// (CHANNEL_COUNT, page 12), with no invented global-volume or mute relationship.
/// Reports establish no audibility, streaming, readiness, control or tune/TX/RF state.
public struct TCIReceiverChannelVolumeObservation: Equatable, Sendable {
    public let rawDB: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive RX_BALANCE reply/broadcast (pinned TCI b081213f, pages 22–23).
/// Raw per receiver/channel balance dB within [-40, 40], not measured stereo
/// output, audibility, streaming, mute/volume, readiness or control authority.
/// It provides no tune/TX/RF evidence.
public struct TCIReceiverChannelBalanceObservation: Equatable, Sendable {
    public let rawDB: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive global MON_VOLUME reply/broadcast (pinned TCI b081213f, page 23).
/// Raw monitor-volume dB within [-60, 0], independent of other volume/mute
/// reports. It establishes neither monitoring enablement nor audibility,
/// streaming, readiness, control authority or tune/TX/RF state.
public struct TCIServerMonitorVolumeObservation: Equatable, Sendable {
    public let rawDB: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive global MON_ENABLE reply/broadcast (pinned TCI b081213f, page 23).
/// Reports the monitoring-enable setting, not actual monitor audio/activity,
/// streaming, readiness, control authority or tune/TX/RF state.
public struct TCIServerMonitorEnableObservation: Equatable, Sendable {
    public let isEnabled: Bool
    /// Exact decoded boolean token, including ASCII letter case.
    public let rawEnabledToken: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Official receiver AGC mode vocabulary (pinned TCI b081213f, page 24).
public enum TCIAGCMode: String, CaseIterable, Sendable {
    case normal
    case fast
    case off
}

/// Passive AGC_MODE setting report, scoped to one receiver, never a channel.
/// It establishes no gain/processing effect, modulation, audio, readiness,
/// control authority or tune/TX/RF state.
public struct TCIReceiverAGCModeObservation: Equatable, Sendable {
    public let mode: TCIAGCMode
    public let rawModeToken: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive receiver AGC_GAIN reply/broadcast (pinned TCI b081213f, page 24).
/// Raw dB setting within [-20, 120], not AGC mode/enabled state, measured gain,
/// signal quality, audio, readiness, control authority or tune/TX/RF evidence.
public struct TCIReceiverAGCGainObservation: Equatable, Sendable {
    public let rawDB: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

/// Passive RX_NB_ENABLE setting report (pinned TCI b081213f, page 24).
/// Receiver-wide, not a channel, capability declaration, NB parameter report,
/// measured processing/interference reduction, audio, readiness, control or RF evidence.
public struct TCIReceiverNoiseBlankerEnableObservation: Equatable, Sendable {
    public let isEnabled: Bool
    public let rawEnabledToken: String
    /// Local producer receipt time; nil means no timed receipt was supplied.
    public let receivedAt: Date?
}

public struct TCIProtocolState: Equatable, Sendable {
    public internal(set) var protocolAnnouncement: TCIProtocolAnnouncement?
    public internal(set) var device: String?
    public internal(set) var receiveOnly: Bool?
    public internal(set) var trxCount: Int?
    public internal(set) var channelCount: Int?
    public internal(set) var vfoLimits: TCINumericRange?
    public internal(set) var ifLimits: TCINumericRange?
    public internal(set) var supportedModulations: [String] = []
    public internal(set) var serverRunning: Bool?
    public internal(set) var ready = false
    public internal(set) var frequencies: [TCIReceiverAddress: Int64] = [:]
    public internal(set) var serverTransmitFrequency: TCIServerTransmitFrequencyObservation?
    public internal(set) var lastRXSpotClick: TCIRXSpotClickObservation?
    public internal(set) var lastLegacySpotClick: TCILegacySpotClickObservation?
    public internal(set) var serverAppFocus: TCIServerAppFocusObservation?
    public internal(set) var lastCWMacrosEmpty: TCICWMacrosEmptyObservation?
    public internal(set) var lastCallsignSend: TCICallsignSendObservation?
    public internal(set) var vfoLocks: [TCIReceiverAddress: TCIVFOLockObservation] = [:]
    public internal(set) var receiveChannelSensors: [TCIReceiverAddress: TCIRXChannelSensorsObservation] = [:]
    public internal(set) var legacyReceiveSensors: [Int: TCILegacyRXSensorsObservation] = [:]
    public internal(set) var transmitSensors: [Int: TCITXSensorsObservation] = [:]
    public internal(set) var serverMainMute: TCIServerMainMuteObservation?
    public internal(set) var receiverMutes: [Int: TCIReceiverMuteObservation] = [:]
    public internal(set) var serverMainVolume: TCIServerMainVolumeObservation?
    public internal(set) var receiverChannelVolumes: [TCIReceiverAddress: TCIReceiverChannelVolumeObservation] = [:]
    public internal(set) var receiverChannelBalances: [TCIReceiverAddress: TCIReceiverChannelBalanceObservation] = [:]
    public internal(set) var serverMonitorVolume: TCIServerMonitorVolumeObservation?
    public internal(set) var serverMonitorEnable: TCIServerMonitorEnableObservation?
    public internal(set) var receiverAGCModes: [Int: TCIReceiverAGCModeObservation] = [:]
    public internal(set) var receiverAGCGains: [Int: TCIReceiverAGCGainObservation] = [:]
    public internal(set) var receiverNoiseBlankerEnables: [Int: TCIReceiverNoiseBlankerEnableObservation] = [:]
    public internal(set) var transceivers: [Int: TCITransceiverState] = [:]
    public internal(set) var unknownCommands: [TCICommand] = []
    public internal(set) var diagnostics: [TCIDiagnostic] = []

    public init() {}
}

/// Applies parsed commands to a connection-scoped state. Create a new reducer
/// for every transport generation; no state is intended to survive reconnect.
public struct TCIStateReducer: Sendable {
    public let limits: TCIProtocolLimits
    public private(set) var state = TCIProtocolState()
    private var commandRejected = false

    public init(limits: TCIProtocolLimits = .default) {
        self.limits = limits
    }

    public mutating func apply(_ result: TCITextDecodeResult, receivedAt: Date? = nil) {
        for diagnostic in result.diagnostics { appendDiagnostic(diagnostic) }
        for command in result.commands { apply(command, receivedAt: receivedAt) }
    }

    /// Reports acceptance even when valid repeated evidence does not change state.
    @discardableResult
    public mutating func apply(_ command: TCICommand, receivedAt: Date? = nil) -> Bool {
        commandRejected = false
        switch command.name.uppercased() {
        case "PROTOCOL": applyProtocol(command)
        case "DEVICE": applyDevice(command)
        case "RECEIVE_ONLY": applyReceiveOnly(command)
        case "TRX_COUNT": applyTRXCount(command)
        case "CHANNEL_COUNT", "CHANNELS_COUNT": applyChannelCount(command)
        case "VFO_LIMITS": applyVFOLimits(command)
        case "IF_LIMITS": applyIFLimits(command)
        case "MODULATIONS_LIST": applyModulations(command)
        case "START":
            if acceptsNoArguments(command) { state.serverRunning = true }
        case "STOP":
            if acceptsNoArguments(command) { state.serverRunning = false }
        case "READY":
            if acceptsNoArguments(command) { state.ready = true }
        case "VFO": applyVFO(command)
        case "TX_FREQUENCY": applyTXFrequency(command, receivedAt: receivedAt)
        case "RX_CLICKED_ON_SPOT": applyRXSpotClick(command, receivedAt: receivedAt)
        case "CLICKED_ON_SPOT": applyLegacySpotClick(command, receivedAt: receivedAt)
        case "APP_FOCUS": applyAppFocus(command, receivedAt: receivedAt)
        case "CW_MACROS_EMPTY":
            if acceptsNoArguments(command) {
                state.lastCWMacrosEmpty = TCICWMacrosEmptyObservation(receivedAt: receivedAt)
            }
        case "CALLSIGN_SEND": applyCallsignSend(command, receivedAt: receivedAt)
        case "VFO_LOCK": applyVFOLock(command, receivedAt: receivedAt)
        case "RX_CHANNEL_SENSORS": applyRXChannelSensors(command, receivedAt: receivedAt)
        case "RX_SENSORS": applyLegacyRXSensors(command, receivedAt: receivedAt)
        case "TX_SENSORS": applyTXSensors(command, receivedAt: receivedAt)
        case "MUTE": applyMainMute(command, receivedAt: receivedAt)
        case "RX_MUTE": applyReceiverMute(command, receivedAt: receivedAt)
        case "VOLUME": applyMainVolume(command, receivedAt: receivedAt)
        case "RX_VOLUME": applyReceiverChannelVolume(command, receivedAt: receivedAt)
        case "RX_BALANCE": applyReceiverChannelBalance(command, receivedAt: receivedAt)
        case "MON_VOLUME": applyMonitorVolume(command, receivedAt: receivedAt)
        case "MON_ENABLE": applyMonitorEnable(command, receivedAt: receivedAt)
        case "AGC_MODE": applyAGCMode(command, receivedAt: receivedAt)
        case "AGC_GAIN": applyAGCGain(command, receivedAt: receivedAt)
        case "RX_NB_ENABLE": applyNoiseBlankerEnable(command, receivedAt: receivedAt)
        case "MODULATION": applyModulation(command)
        case "RX_FILTER_BAND": applyFilter(command)
        case "SPLIT_ENABLE": applyBooleanState(command, keyPath: \.splitEnabled)
        case "RX_ENABLE": applyBooleanState(command, keyPath: \.receiveEnabled)
        case "TX_ENABLE": applyBooleanState(command, keyPath: \.transmitEnabled)
        case "TRX": applyTRX(command)
        case "TUNE": applyBooleanState(command, keyPath: \.tuning)
        default:
            commandRejected = true
            appendUnknown(command)
            appendDiagnostic(TCIDiagnostic(kind: .unknownCommand, commandName: command.name))
        }
        return !commandRejected
    }

    public func authoritativeSnapshot(for address: TCIReceiverAddress) -> TCIAuthoritativeSnapshot? {
        guard state.ready,
              let announcement = state.protocolAnnouncement,
              let device = state.device,
              let receiveOnly = state.receiveOnly,
              let trxCount = state.trxCount,
              let channelCount = state.channelCount,
              let vfoLimits = state.vfoLimits,
              let ifLimits = state.ifLimits,
              !state.supportedModulations.isEmpty,
              address.trx >= 0, address.trx < trxCount,
              address.channel >= 0, address.channel < channelCount,
              let frequency = state.frequencies[address],
              vfoLimits.contains(Double(frequency)),
              let transceiver = state.transceivers[address.trx],
              let modulation = transceiver.modulation,
              state.supportedModulations.contains(modulation)
        else { return nil }

        return TCIAuthoritativeSnapshot(
            address: address,
            protocolAnnouncement: announcement,
            device: device,
            receiveOnly: receiveOnly,
            trxCount: trxCount,
            channelCount: channelCount,
            vfoLimits: vfoLimits,
            ifLimits: ifLimits,
            supportedModulations: state.supportedModulations,
            serverRunning: state.serverRunning,
            frequencyHz: frequency,
            transceiver: transceiver
        )
    }

    private mutating func applyProtocol(_ command: TCICommand) {
        guard command.arguments.count == 2,
              !command.arguments[0].isEmpty,
              !command.arguments[1].isEmpty
        else { return reject(command) }
        state.protocolAnnouncement = TCIProtocolAnnouncement(
            program: command.arguments[0],
            version: command.arguments[1]
        )
    }

    private mutating func applyDevice(_ command: TCICommand) {
        guard command.arguments.count == 1, !command.arguments[0].isEmpty else { return reject(command) }
        state.device = command.arguments[0]
    }

    private mutating func applyReceiveOnly(_ command: TCICommand) {
        guard command.arguments.count == 1,
              let value = TCIValueParser.boolean(command.arguments[0])
        else { return reject(command) }
        state.receiveOnly = value
    }

    private mutating func applyTRXCount(_ command: TCICommand) {
        guard command.arguments.count == 1,
              let value = TCIValueParser.integer(command.arguments[0]),
              value > 0, value <= limits.maximumTRXCount
        else { return reject(command, kind: .outOfBounds) }
        state.trxCount = value
        pruneForAnnouncedBounds()
    }

    private mutating func applyChannelCount(_ command: TCICommand) {
        guard command.arguments.count == 1,
              let value = TCIValueParser.integer(command.arguments[0]),
              value > 0, value <= limits.maximumChannelCount
        else { return reject(command, kind: .outOfBounds) }
        state.channelCount = value
        pruneForAnnouncedBounds()
    }

    private mutating func applyVFOLimits(_ command: TCICommand) {
        guard command.arguments.count == 2,
              let lower = TCIValueParser.finiteDouble(command.arguments[0]),
              let upper = TCIValueParser.finiteDouble(command.arguments[1]),
              lower >= 0, upper > lower, upper <= Double(limits.maximumFrequencyHz)
        else { return reject(command, kind: .outOfBounds) }
        state.vfoLimits = TCINumericRange(lower: lower, upper: upper)
        state.frequencies = state.frequencies.filter { _, frequency in
            state.vfoLimits?.contains(Double(frequency)) == true
        }
    }

    private mutating func applyIFLimits(_ command: TCICommand) {
        guard command.arguments.count == 2,
              let lower = TCIValueParser.finiteDouble(command.arguments[0]),
              let upper = TCIValueParser.finiteDouble(command.arguments[1]),
              lower < upper,
              abs(lower) <= Double(limits.maximumFrequencyHz),
              abs(upper) <= Double(limits.maximumFrequencyHz)
        else { return reject(command, kind: .outOfBounds) }
        state.ifLimits = TCINumericRange(lower: lower, upper: upper)
    }

    private mutating func applyModulations(_ command: TCICommand) {
        let values = command.arguments.map { $0.uppercased() }
        guard !values.isEmpty, values.allSatisfy({ !$0.isEmpty }) else { return reject(command) }
        var seen = Set<String>()
        state.supportedModulations = values.filter { seen.insert($0).inserted }
    }

    private mutating func acceptsNoArguments(_ command: TCICommand) -> Bool {
        guard command.arguments.isEmpty else {
            reject(command)
            return false
        }
        return true
    }

    private mutating func applyVFO(_ command: TCICommand) {
        guard command.arguments.count == 3,
              let trx = validTRX(command.arguments[0]),
              let channel = validChannel(command.arguments[1]),
              let frequency = TCIValueParser.integer64(command.arguments[2]),
              frequency >= 0, frequency <= limits.maximumFrequencyHz,
              state.vfoLimits?.contains(Double(frequency)) != false
        else { return reject(command, kind: .outOfBounds) }
        state.frequencies[TCIReceiverAddress(trx: trx, channel: channel)] = frequency
    }

    private mutating func applyTXFrequency(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 1,
              let frequency = TCIValueParser.integer64(command.arguments[0]),
              frequency >= 0, frequency <= limits.maximumFrequencyHz
        else { return reject(command, kind: .outOfBounds) }
        // Application numeric envelope only. VFO_LIMITS describes receive VFO
        // tuning and must not constrain this independent global notification.
        state.serverTransmitFrequency = TCIServerTransmitFrequencyObservation(
            frequencyHz: frequency, receivedAt: receivedAt
        )
    }

    private mutating func applyNoiseBlankerEnable(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 2,
              let trx = validTRX(command.arguments[0]),
              command.arguments[1].utf8.count <= limits.maximumArgumentBytes,
              let enabled = TCIValueParser.boolean(command.arguments[1])
        else { return reject(command) }
        state.receiverNoiseBlankerEnables[trx] = TCIReceiverNoiseBlankerEnableObservation(
            isEnabled: enabled, rawEnabledToken: command.arguments[1], receivedAt: receivedAt
        )
    }

    private mutating func applyAGCGain(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 2,
              let trx = validTRX(command.arguments[0]),
              let rawDB = decimalDBToken(command.arguments[1], in: -20...120)
        else { return reject(command) }
        state.receiverAGCGains[trx] = TCIReceiverAGCGainObservation(rawDB: rawDB, receivedAt: receivedAt)
    }

    private mutating func applyAGCMode(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 2,
              let trx = validTRX(command.arguments[0]),
              command.arguments[1].utf8.count <= limits.maximumArgumentBytes,
              let mode = TCIAGCMode(rawValue: command.arguments[1].lowercased())
        else { return reject(command) }
        state.receiverAGCModes[trx] = TCIReceiverAGCModeObservation(
            mode: mode, rawModeToken: command.arguments[1], receivedAt: receivedAt
        )
    }

    private mutating func applyMonitorEnable(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 1,
              command.arguments[0].utf8.count <= limits.maximumArgumentBytes,
              let enabled = TCIValueParser.boolean(command.arguments[0])
        else { return reject(command) }
        state.serverMonitorEnable = TCIServerMonitorEnableObservation(
            isEnabled: enabled, rawEnabledToken: command.arguments[0], receivedAt: receivedAt
        )
    }

    private mutating func applyMonitorVolume(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 1, let rawDB = decimalDBToken(command.arguments[0], in: -60...0)
        else { return reject(command) }
        state.serverMonitorVolume = TCIServerMonitorVolumeObservation(rawDB: rawDB, receivedAt: receivedAt)
    }

    private mutating func applyReceiverChannelBalance(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 3,
              let trx = validTRX(command.arguments[0]),
              let channel = validChannel(command.arguments[1]),
              let rawDB = decimalDBToken(command.arguments[2], in: -40...40)
        else { return reject(command) }
        state.receiverChannelBalances[TCIReceiverAddress(trx: trx, channel: channel)] = TCIReceiverChannelBalanceObservation(
            rawDB: rawDB, receivedAt: receivedAt
        )
    }

    private mutating func applyReceiverChannelVolume(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 3,
              let trx = validTRX(command.arguments[0]),
              let channel = validChannel(command.arguments[1]),
              let rawDB = decimalDBToken(command.arguments[2], in: -60...0)
        else { return reject(command) }
        state.receiverChannelVolumes[TCIReceiverAddress(trx: trx, channel: channel)] = TCIReceiverChannelVolumeObservation(
            rawDB: rawDB, receivedAt: receivedAt
        )
    }

    private mutating func applyMainVolume(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 1, let rawDB = decimalDBToken(command.arguments[0], in: -60...0)
        else { return reject(command) }
        state.serverMainVolume = TCIServerMainVolumeObservation(rawDB: rawDB, receivedAt: receivedAt)
    }

    private func decimalDBToken(_ value: String, in range: ClosedRange<Int>) -> String? {
        guard let token = TCIValueParser.boundedDecimalToken(value, maximumBytes: limits.maximumArgumentBytes)
        else { return nil }
        let magnitude = token.dropFirst(token.hasPrefix("-") || token.hasPrefix("+") ? 1 : 0)
        let components = magnitude.split(separator: ".")
        let whole = components[0].drop(while: { $0 == "0" })
        guard let integral = Int(whole.isEmpty ? "0" : String(whole)) else { return nil }
        let negative = token.hasPrefix("-")
        let signedIntegral = negative ? -integral : integral
        guard range.contains(signedIntegral) else { return nil }
        let nonzeroFraction = components.count == 2 && components[1].contains(where: { $0 != "0" })
        // At the signed endpoint, any nonzero fractional digit is out of range.
        // Preserve exact bounds without rounding through Double or Decimal.
        let outwardEndpoint = negative ? range.lowerBound : range.upperBound
        guard !nonzeroFraction || signedIntegral != outwardEndpoint else { return nil }
        return token
    }

    private mutating func applyReceiverMute(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 2,
              let trx = validTRX(command.arguments[0]),
              let muted = TCIValueParser.boolean(command.arguments[1])
        else { return reject(command) }
        state.receiverMutes[trx] = TCIReceiverMuteObservation(isMuted: muted, receivedAt: receivedAt)
    }

    private mutating func applyMainMute(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 1,
              let muted = TCIValueParser.boolean(command.arguments[0])
        else { return reject(command) }
        state.serverMainMute = TCIServerMainMuteObservation(isMuted: muted, receivedAt: receivedAt)
    }

    private mutating func applyAppFocus(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 1,
              let focused = TCIValueParser.boolean(command.arguments[0])
        else { return reject(command) }
        state.serverAppFocus = TCIServerAppFocusObservation(isFocused: focused, receivedAt: receivedAt)
    }

    private mutating func applyTXSensors(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 5,
              let trx = validTRX(command.arguments[0]),
              let microphone = TCIValueParser.boundedDecimalToken(command.arguments[1], maximumBytes: limits.maximumArgumentBytes),
              let rms = TCIValueParser.boundedDecimalToken(command.arguments[2], maximumBytes: limits.maximumArgumentBytes),
              let peak = TCIValueParser.boundedDecimalToken(command.arguments[3], maximumBytes: limits.maximumArgumentBytes),
              let swr = TCIValueParser.boundedDecimalToken(command.arguments[4], maximumBytes: limits.maximumArgumentBytes)
        else { return reject(command) }
        state.transmitSensors[trx] = TCITXSensorsObservation(
            rawMicrophoneDBm: microphone, rawRMSWatts: rms, rawPeakWatts: peak,
            rawSWR: swr, receivedAt: receivedAt
        )
    }

    private mutating func applyLegacyRXSensors(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 2,
              let trx = validTRX(command.arguments[0]),
              let rawDBm = TCIValueParser.boundedDecimalToken(command.arguments[1], maximumBytes: limits.maximumArgumentBytes)
        else { return reject(command) }
        state.legacyReceiveSensors[trx] = TCILegacyRXSensorsObservation(rawDBm: rawDBm, receivedAt: receivedAt)
    }

    private mutating func applyRXChannelSensors(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 3,
              let trx = validTRX(command.arguments[0]),
              let channel = validChannel(command.arguments[1]), channel <= 1,
              let rawDBm = TCIValueParser.boundedDecimalToken(command.arguments[2], maximumBytes: limits.maximumArgumentBytes)
        else { return reject(command) }
        state.receiveChannelSensors[TCIReceiverAddress(trx: trx, channel: channel)] = TCIRXChannelSensorsObservation(
            rawDBm: rawDBm, receivedAt: receivedAt
        )
    }

    private mutating func applyVFOLock(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 3,
              let trx = validTRX(command.arguments[0]),
              let channel = validChannel(command.arguments[1]), channel <= 1,
              let locked = TCIValueParser.boolean(command.arguments[2])
        else { return reject(command) }
        state.vfoLocks[TCIReceiverAddress(trx: trx, channel: channel)] = TCIVFOLockObservation(
            isLocked: locked, receivedAt: receivedAt
        )
    }

    private mutating func applyCallsignSend(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 1, validCallsignToken(command.arguments[0])
        else { return reject(command) }
        state.lastCallsignSend = TCICallsignSendObservation(callsign: command.arguments[0], receivedAt: receivedAt)
    }

    private mutating func applyLegacySpotClick(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 2,
              validCallsignToken(command.arguments[0]),
              let frequency = TCIValueParser.integer64(command.arguments[1]),
              frequency >= 0, frequency <= limits.maximumFrequencyHz
        else { return reject(command) }
        // Keep legacy and addressed notifications independent: the protocol
        // supplies neither an event ID nor a receiver for this legacy form.
        state.lastLegacySpotClick = TCILegacySpotClickObservation(
            callsign: command.arguments[0], frequencyHz: frequency, receivedAt: receivedAt
        )
    }

    private func validCallsignToken(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= limits.maximumArgumentBytes
            && value.utf8.allSatisfy { $0 >= 33 && $0 <= 126 && $0 != 44 && $0 != 58 && $0 != 59 }
    }

    private mutating func applyRXSpotClick(_ command: TCICommand, receivedAt: Date?) {
        guard command.arguments.count == 4,
              let trx = validTRX(command.arguments[0]),
              let channel = validChannel(command.arguments[1]), channel <= 1,
              validCallsignToken(command.arguments[2]),
              let frequency = TCIValueParser.integer64(command.arguments[3]),
              frequency >= 0, frequency <= limits.maximumFrequencyHz
        else { return reject(command) }
        // The notification identifies a clicked spot, not the receiver's current
        // VFO or mode. Retain only one event and its own optional receipt.
        state.lastRXSpotClick = TCIRXSpotClickObservation(
            address: TCIReceiverAddress(trx: trx, channel: channel),
            callsign: command.arguments[2], frequencyHz: frequency, receivedAt: receivedAt
        )
    }

    private mutating func applyModulation(_ command: TCICommand) {
        guard command.arguments.count == 2,
              let trx = validTRX(command.arguments[0]),
              !command.arguments[1].isEmpty
        else { return reject(command) }
        let modulation = command.arguments[1].uppercased()
        guard state.supportedModulations.isEmpty || state.supportedModulations.contains(modulation) else {
            return reject(command, kind: .outOfBounds)
        }
        mutateTransceiver(trx) { $0.modulation = modulation }
    }

    private mutating func applyFilter(_ command: TCICommand) {
        guard command.arguments.count == 3,
              let trx = validTRX(command.arguments[0]),
              let low = TCIValueParser.integer64(command.arguments[1]),
              let high = TCIValueParser.integer64(command.arguments[2]),
              low < high,
              filterIsWithinProtocolEnvelope(low: low, high: high)
        else { return reject(command, kind: .outOfBounds) }
        mutateTransceiver(trx) { $0.receiveFilter = TCIFilterBand(lowHz: low, highHz: high) }
    }

    private mutating func applyBooleanState(
        _ command: TCICommand,
        keyPath: WritableKeyPath<TCITransceiverState, Bool?>
    ) {
        guard command.arguments.count == 2,
              let trx = validTRX(command.arguments[0]),
              let value = TCIValueParser.boolean(command.arguments[1])
        else { return reject(command) }
        mutateTransceiver(trx) { $0[keyPath: keyPath] = value }
    }

    private mutating func applyTRX(_ command: TCICommand) {
        guard command.arguments.count == 2 || command.arguments.count == 3,
              let trx = validTRX(command.arguments[0]),
              let transmitting = TCIValueParser.boolean(command.arguments[1]),
              command.arguments.count == 2 || !command.arguments[2].isEmpty
        else { return reject(command) }
        mutateTransceiver(trx) {
            $0.transmitting = transmitting
            $0.transmitSignalSource = command.arguments.count == 3 ? command.arguments[2].lowercased() : nil
        }
    }

    private func validTRX(_ value: String) -> Int? {
        guard let parsed = TCIValueParser.integer(value), parsed >= 0, parsed < limits.maximumTRXCount else {
            return nil
        }
        if let count = state.trxCount, parsed >= count { return nil }
        return parsed
    }

    private func validChannel(_ value: String) -> Int? {
        guard let parsed = TCIValueParser.integer(value), parsed >= 0, parsed < limits.maximumChannelCount else {
            return nil
        }
        if let count = state.channelCount, parsed >= count { return nil }
        return parsed
    }

    private func filterIsWithinProtocolEnvelope(low: Int64, high: Int64) -> Bool {
        // IF_LIMITS constrains VFO-A IF tuning, not RX_FILTER_BAND (official
        // b081213f p20). This is only the parser's app-local numeric envelope.
        return low >= -limits.maximumFrequencyHz && high <= limits.maximumFrequencyHz
    }

    private mutating func mutateTransceiver(_ trx: Int, mutation: (inout TCITransceiverState) -> Void) {
        var value = state.transceivers[trx] ?? TCITransceiverState()
        mutation(&value)
        state.transceivers[trx] = value
    }

    private mutating func pruneForAnnouncedBounds() {
        if let trxCount = state.trxCount {
            state.transceivers = state.transceivers.filter { $0.key < trxCount }
            state.frequencies = state.frequencies.filter { $0.key.trx < trxCount }
            state.vfoLocks = state.vfoLocks.filter { $0.key.trx < trxCount }
            state.receiveChannelSensors = state.receiveChannelSensors.filter { $0.key.trx < trxCount }
            state.legacyReceiveSensors = state.legacyReceiveSensors.filter { $0.key < trxCount }
            state.transmitSensors = state.transmitSensors.filter { $0.key < trxCount }
            state.receiverMutes = state.receiverMutes.filter { $0.key < trxCount }
            state.receiverAGCModes = state.receiverAGCModes.filter { $0.key < trxCount }
            state.receiverAGCGains = state.receiverAGCGains.filter { $0.key < trxCount }
            state.receiverNoiseBlankerEnables = state.receiverNoiseBlankerEnables.filter { $0.key < trxCount }
            state.receiverChannelVolumes = state.receiverChannelVolumes.filter { $0.key.trx < trxCount }
            state.receiverChannelBalances = state.receiverChannelBalances.filter { $0.key.trx < trxCount }
        }
        if let channelCount = state.channelCount {
            state.frequencies = state.frequencies.filter { $0.key.channel < channelCount }
            state.vfoLocks = state.vfoLocks.filter { $0.key.channel < channelCount }
            state.receiveChannelSensors = state.receiveChannelSensors.filter { $0.key.channel < channelCount }
            state.receiverChannelVolumes = state.receiverChannelVolumes.filter { $0.key.channel < channelCount }
            state.receiverChannelBalances = state.receiverChannelBalances.filter { $0.key.channel < channelCount }
        }
    }

    private mutating func reject(_ command: TCICommand, kind: TCIDiagnosticKind = .invalidArguments) {
        commandRejected = true
        appendDiagnostic(TCIDiagnostic(kind: kind, commandName: command.name))
    }

    private mutating func appendUnknown(_ command: TCICommand) {
        state.unknownCommands.append(command)
        if state.unknownCommands.count > limits.maximumUnknownCommands {
            state.unknownCommands.removeFirst(state.unknownCommands.count - limits.maximumUnknownCommands)
        }
    }

    private mutating func appendDiagnostic(_ diagnostic: TCIDiagnostic) {
        state.diagnostics.append(diagnostic)
        if state.diagnostics.count > limits.maximumDiagnostics {
            state.diagnostics.removeFirst(state.diagnostics.count - limits.maximumDiagnostics)
        }
    }
}
