import Foundation

public actor CATCommandProcessor {
    private let radio: any RadioControlling
    private let allowTransmit: Bool
    private var autoInformation = 0

    public init(radio: any RadioControlling, allowTransmit: Bool = false) {
        self.radio = radio
        self.allowTransmit = allowTransmit
    }

    public func handle(_ rawCommand: String) async -> String? {
        let command = rawCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else { return nil }

        let snapshot = await radio.snapshot()
        switch command.uppercased() {
        case "ID":
            return "ID019;"
        case "PS":
            return "PS1;"
        case "AI": return "AI\(autoInformation);"
        case "FA":
            guard snapshot.isConnected, let frequency = await radio.primaryFrequency() else { return "?;" }
            return Self.frequencyResponse(prefix: "FA", hertz: frequency)
        case "FB":
            let secondary = await radio.secondaryFrequency()
            let primary = await radio.primaryFrequency()
            guard snapshot.isConnected, let frequency = secondary ?? primary else { return "?;" }
            return Self.frequencyResponse(prefix: "FB", hertz: frequency)
        case "FR":
            guard snapshot.isConnected else { return "?;" }
            return "FR\(Self.receiveVFO(for: snapshot));"
        case "FT":
            guard snapshot.isConnected else { return "?;" }
            return "FT\(Self.transmitVFO(for: snapshot));"
        case "KS": return String(format: "KS%03d;", await radio.cwSpeed())
        case "IF":
            guard snapshot.isConnected else { return "?;" }
            return Self.informationResponse(snapshot: snapshot, transmitVFO: Self.transmitVFO(for: snapshot))
        case "MD":
            guard snapshot.isConnected else { return "?;" }
            return "MD\(Self.kenwoodMode(for: snapshot.mode));"
        case "RT":
            guard snapshot.isConnected, let vfo = Self.receiveVFOState(snapshot) else { return "?;" }
            return "RT\(vfo.ritEnabled ? 1 : 0);"
        case "XT":
            guard snapshot.isConnected, let vfo = Self.receiveVFOState(snapshot) else { return "?;" }
            return "XT\(vfo.xitEnabled ? 1 : 0);"
        case "PC":
            guard snapshot.isConnected, let watts = snapshot.rfPowerWatts else { return "?;" }
            return String(format: "PC%03d;", watts)
        case "TX", "TX0", "TX1", "TX2":
            guard allowTransmit else { return "?;" }
            do {
                let mode: CATTransmitMode = command.uppercased() == "TX2" ? .tune : (command.uppercased() == "TX1" ? .data : .microphone)
                try await radio.setTransmit(mode)
                return nil
            } catch {
                return "?;"
            }
        case "RX":
            do {
                try await radio.setTransmit(false)
                return nil
            } catch {
                return "?;"
            }
        default:
            if command.uppercased().hasPrefix("AI"), command.count == 3,
               let value = Int(command.dropFirst(2)), (0...2).contains(value) {
                autoInformation = value
                return nil
            }
            if command.uppercased().hasPrefix("FA"), command.count > 2 {
                return await setFrequency(String(command.dropFirst(2)))
            }
            if command.uppercased().hasPrefix("FB"), command.count > 2 {
                return await setSecondaryFrequency(String(command.dropFirst(2)))
            }
            if command.uppercased().hasPrefix("MD"), command.count > 2 {
                return await setMode(String(command.dropFirst(2)))
            }
            if command.uppercased().hasPrefix("KS"), command.count > 2 {
                return await setCWSpeed(String(command.dropFirst(2)))
            }
            if command.uppercased().hasPrefix("FR"), command.count == 3 {
                return await setReceiveVFO(String(command.dropFirst(2)))
            }
            if command.uppercased().hasPrefix("FT"), command.count == 3 {
                return await setTransmitVFO(String(command.dropFirst(2)))
            }
            if command.uppercased().hasPrefix("KY") {
                return await handleCW(String(command.dropFirst(2)))
            }
            if command.uppercased().hasPrefix("RT"), command.count == 3 {
                return await setRIT(String(command.dropFirst(2)), snapshot: snapshot)
            }
            if command.uppercased().hasPrefix("XT"), command.count == 3 {
                return await setXIT(String(command.dropFirst(2)), snapshot: snapshot)
            }
            if command.uppercased().hasPrefix("PC"), command.count == 5 {
                return await setRFPower(String(command.dropFirst(2)))
            }
            return "?;"
        }
    }

    private func setSecondaryFrequency(_ value: String) async -> String? {
        guard value.count == 11, let frequency = Int64(value), frequency > 0 else { return "?;" }
        do { try await radio.setSecondaryFrequency(frequency); return nil } catch { return "?;" }
    }

    private func setCWSpeed(_ value: String) async -> String? {
        guard value.count == 3, let speed = Int(value), (5...100).contains(speed) else { return "?;" }
        do { try await radio.setCWSpeed(speed); return nil } catch { return "?;" }
    }

    private func setReceiveVFO(_ value: String) async -> String? {
        guard let vfo = Int(value), vfo == 0 || vfo == 1 else { return "?;" }
        do { try await radio.setReceiveVFO(vfo); return nil } catch { return "?;" }
    }

    private func setTransmitVFO(_ value: String) async -> String? {
        guard let vfo = Int(value), vfo == 0 || vfo == 1 else { return "?;" }
        do { try await radio.setSplitTransmit(vfo == 1); return nil } catch { return "?;" }
    }

    private func handleCW(_ value: String) async -> String? {
        if value.isEmpty { return "KY0;" }
        guard allowTransmit else { return "?;" }
        if value.trimmingCharacters(in: .whitespaces).isEmpty {
            do { try await radio.clearCW(); return nil } catch { return "?;" }
        }
        guard value.count <= 128 else { return "?;" }
        do { try await radio.sendCW(value.trimmingCharacters(in: .whitespaces)); return nil } catch { return "?;" }
    }

    private func setFrequency(_ value: String) async -> String? {
        guard let frequency = Int64(value), frequency > 0 else { return "?;" }
        do {
            try await radio.setPrimaryFrequency(frequency)
            return nil
        } catch {
            return "?;"
        }
    }

    private func setMode(_ value: String) async -> String? {
        guard let mode = Self.flexMode(forKenwoodCode: value) else { return "?;" }
        do {
            try await radio.setMode(mode)
            return nil
        } catch {
            return "?;"
        }
    }

    private func setRIT(_ value: String, snapshot: RadioSnapshot) async -> String? {
        guard let enabled = Self.binary(value), let vfo = Self.receiveVFOState(snapshot) else { return "?;" }
        do {
            try await radio.setRIT(enabled: enabled, offsetHz: vfo.ritOffsetHz, vfo: vfo.letter)
            return nil
        } catch {
            return "?;"
        }
    }

    private func setXIT(_ value: String, snapshot: RadioSnapshot) async -> String? {
        guard allowTransmit,
              let enabled = Self.binary(value),
              let vfo = Self.receiveVFOState(snapshot) else { return "?;" }
        do {
            try await radio.setXIT(enabled: enabled, offsetHz: vfo.xitOffsetHz, vfo: vfo.letter)
            return nil
        } catch {
            return "?;"
        }
    }

    private func setRFPower(_ value: String) async -> String? {
        guard allowTransmit, let watts = Int(value), watts > 0 else { return "?;" }
        do {
            try await radio.setRFPower(watts)
            return nil
        } catch {
            return "?;"
        }
    }

    private static func frequencyResponse(prefix: String, hertz: Int64) -> String {
        String(format: "%@%011lld;", prefix, hertz)
    }

    private static func kenwoodMode(for mode: String) -> Int {
        switch mode.uppercased() {
        case "LSB": 1
        case "USB": 2
        case "CW": 3
        case "FM", "NFM", "DFM", "PKTFM": 4
        case "AM", "SAM": 5
        case "DIGL", "PKTLSB", "RTTY", "RTTYR": 6
        case "CWR": 7
        case "DIGU", "PKTUSB": 9
        default: 2
        }
    }

    private static func flexMode(forKenwoodCode code: String) -> String? {
        switch code {
        case "1": "LSB"
        case "2": "USB"
        case "3": "CW"
        case "4": "FM"
        case "5": "AM"
        case "6": "RTTY"
        case "7": "CWR"
        case "9": "DIGU"
        default: nil
        }
    }

    private static func informationResponse(snapshot: RadioSnapshot, transmitVFO: Int) -> String {
        let frequency = String(format: "%011lld", snapshot.frequencyHz)
        let mode = kenwoodMode(for: snapshot.mode)
        let tx = snapshot.isTransmitting ? 1 : 0
        return "IF\(frequency)     +000000000\(tx)\(mode)000000\(transmitVFO)0;"
    }

    private static func receiveVFO(for snapshot: RadioSnapshot) -> Int {
        snapshot.vfo("B")?.isReceive == true ? 1 : 0
    }

    private static func transmitVFO(for snapshot: RadioSnapshot) -> Int {
        snapshot.vfo("B")?.isTransmit == true ? 1 : 0
    }

    private static func receiveVFOState(_ snapshot: RadioSnapshot) -> RadioVFO? {
        snapshot.vfo("B")?.isReceive == true ? snapshot.vfo("B") : snapshot.vfo("A")
    }

    private static func binary(_ value: String) -> Bool? {
        value == "0" ? false : (value == "1" ? true : nil)
    }
}
