import Foundation

public actor RigCtlCommandProcessor {
    public typealias StationStateProvider = @Sendable () async -> String?
    public typealias StationActionHandler = @Sendable (String) async -> Bool

    private let radio: any RadioControlling
    private let allowTransmit: Bool
    private let stationStateProvider: StationStateProvider?
    private let stationActionHandler: StationActionHandler?

    public init(
        radio: any RadioControlling,
        allowTransmit: Bool = false,
        stationStateProvider: StationStateProvider? = nil,
        stationActionHandler: StationActionHandler? = nil
    ) {
        self.radio = radio
        self.allowTransmit = allowTransmit
        self.stationStateProvider = stationStateProvider
        self.stationActionHandler = stationActionHandler
    }

    public func handle(_ rawCommand: String) async -> String {
        let command = rawCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        let snapshot = await radio.snapshot()

        if command == "f" {
            guard snapshot.isConnected else { return "RPRT -1\n" }
            return "\(snapshot.frequencyHz)\n"
        }
        if command == "m" {
            guard snapshot.isConnected else { return "RPRT -1\n" }
            return "\(Self.rigCtlMode(snapshot.mode))\n0\n"
        }
        if command == "t" {
            return "\(snapshot.isTransmitting ? 1 : 0)\n"
        }
        if command == "\\get_info" {
            return "OM0RX-xCat\n"
        }
        if command == "\\get_xcat_state" {
            guard let stationStateProvider,
                  let payload = await stationStateProvider() else {
                return "{\"available\":false}\n"
            }
            return payload.hasSuffix("\n") ? payload : payload + "\n"
        }
        if command.hasPrefix("\\xcat_action ") {
            let action = String(command.dropFirst("\\xcat_action ".count))
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            let transmitActions: Set<String> = ["operate", "tune"]
            guard !transmitActions.contains(action) || allowTransmit else { return "RPRT -1\n" }
            guard let stationActionHandler, await stationActionHandler(action) else { return "RPRT -1\n" }
            return "RPRT 0\n"
        }
        if command.hasPrefix("\\xcat_tune ") {
            let fields = command.split(separator: " ", maxSplits: 2)
            guard fields.count == 3,
                  let frequency = Int64(fields[1]),
                  frequency > 0 else { return "RPRT -1\n" }
            do {
                // A cluster-spot tune starts a new simplex operating target. Clear
                // any previous VFO-B split first so the old transmit slice cannot
                // keep the radio and logger pinned to the previous contact.
                try await radio.tuneSimplex(frequency, mode: Self.flexMode(String(fields[2])))
                return "RPRT 0\n"
            } catch {
                return "RPRT -1\n"
            }
        }
        if command.hasPrefix("F ") {
            guard let frequency = Int64(command.dropFirst(2)), frequency > 0 else {
                return "RPRT -1\n"
            }
            do {
                try await radio.setFrequency(frequency)
                return "RPRT 0\n"
            } catch {
                return "RPRT -1\n"
            }
        }
        if command.hasPrefix("M ") {
            let fields = command.split(separator: " ")
            guard fields.count >= 2 else { return "RPRT -1\n" }
            do {
                try await radio.setMode(Self.flexMode(String(fields[1])))
                return "RPRT 0\n"
            } catch {
                return "RPRT -1\n"
            }
        }
        if command.hasPrefix("T ") {
            let enabled = command.dropFirst(2) == "1"
            if enabled && !allowTransmit { return "RPRT -1\n" }
            do {
                try await radio.setTransmit(enabled)
                return "RPRT 0\n"
            } catch {
                return "RPRT -1\n"
            }
        }
        return "RPRT -4\n"
    }

    private static func rigCtlMode(_ mode: String) -> String {
        switch mode.uppercased() {
        case "DIGU": "PKTUSB"
        case "DIGL": "PKTLSB"
        case "NFM", "DFM": "FM"
        default: mode.uppercased()
        }
    }

    private static func flexMode(_ mode: String) -> String {
        switch mode.uppercased() {
        case "PKTUSB": "DIGU"
        case "PKTLSB": "DIGL"
        default: mode.uppercased()
        }
    }
}
