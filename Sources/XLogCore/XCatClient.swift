import Darwin
import Foundation

public struct RadioSnapshot: Equatable, Sendable {
    public let frequencyHz: Int64
    public let mode: String
    public let receiveFrequencyHz: Int64
    public let transmitFrequencyHz: Int64
    public let receiveVFO: String
    public let transmitVFO: String
    public let isSplit: Bool
    public let isTransmitting: Bool

    public init(
        frequencyHz: Int64,
        mode: String,
        receiveFrequencyHz: Int64? = nil,
        transmitFrequencyHz: Int64? = nil,
        receiveVFO: String = "A",
        transmitVFO: String = "A",
        isSplit: Bool = false,
        isTransmitting: Bool = false
    ) {
        self.frequencyHz = frequencyHz
        self.mode = mode
        self.receiveFrequencyHz = receiveFrequencyHz ?? frequencyHz
        self.transmitFrequencyHz = transmitFrequencyHz ?? frequencyHz
        self.receiveVFO = receiveVFO
        self.transmitVFO = transmitVFO
        self.isSplit = isSplit
        self.isTransmitting = isTransmitting
    }
}

public struct XCatStationSnapshot: Decodable, Equatable, Sendable {
    public struct Radio: Decodable, Equatable, Sendable {
        public let observed: Bool?
        public let connected: Bool
        public let frequencyHz: Int64
        public let mode: String
        public let receiveFrequencyHz: Int64?
        public let transmitFrequencyHz: Int64?
        public let receiveVFO: String?
        public let transmitVFO: String?
        public let split: Bool?
        public let isTransmitting: Bool?

        public func confirmsSimplex(frequencyHz target: Int64, radioMode: String) -> Bool {
            observed == true && connected && frequencyHz == target
                && receiveFrequencyHz == target && transmitFrequencyHz == target
                && receiveVFO == "A" && transmitVFO == "A" && split == false
                && mode.uppercased() == radioMode.uppercased()
        }

        public var snapshot: RadioSnapshot? {
            guard connected, frequencyHz > 0, !mode.isEmpty else { return nil }
            let normalized = mode.uppercased()
            let receive = receiveFrequencyHz ?? frequencyHz
            let transmit = transmitFrequencyHz ?? frequencyHz
            return RadioSnapshot(
                frequencyHz: receive,
                mode: normalized.hasPrefix("DIG") ? "FT8" : (["USB", "LSB"].contains(normalized) ? "SSB" : normalized),
                receiveFrequencyHz: receive,
                transmitFrequencyHz: transmit,
                receiveVFO: receiveVFO ?? "A",
                transmitVFO: transmitVFO ?? (receiveVFO ?? "A"),
                isSplit: split ?? (receive != transmit),
                isTransmitting: isTransmitting ?? false
            )
        }
    }

    public struct Station: Decodable, Equatable, Sendable {
        public let available: Bool
        public let commissioned: Bool
        public let coordinatorState: String
        public let allowedActions: [String]
        public let kpaOperate: Bool?
        public let band: String
        public let routeAlignment: String
        public let interlockState: String
        public let txPowerWatts: Double?
        public let swr: Double?
        public let swrIsLive: Bool
        public let rfDriveWatts: Int?
        public let kpaDetailPrimary: String
        public let kpaDetailSecondary: String
        public let katDetailPrimary: String
        public let katDetailSecondary: String
        public let routeDetail: String
        public let alarmSummary: String
    }

    public struct Rotor: Decodable, Equatable, Sendable {
        public let connected: Bool
        public let name: String
        public let homeGrid: String?
        public let azimuth: Double?
        public let targetBearing: Double?
        public let targetLabel: String
        public let status: String
        public let isMoving: Bool
        public let motionDirection: String
    }

    public struct Propagation: Decodable, Equatable, Sendable {
        public struct Band: Decodable, Equatable, Sendable {
            public let name: String
            public let day: String
            public let night: String
        }

        public let status: String
        public let updatedAt: TimeInterval?
        public let solarFlux: Int?
        public let aIndex: Int?
        public let kIndex: Int?
        public let xRay: String
        public let bands: [Band]
    }

    public let available: Bool
    public let generatedAt: TimeInterval
    public let radio: Radio?
    public let station: Station
    public let rotor: Rotor
    public let propagation: Propagation
}

public enum XCatClientError: Error, LocalizedError {
    case invalidHost
    case connect(String)
    case write
    case read
    case timeout
    case invalidResponse
    public var errorDescription: String? {
        switch self {
        case .invalidHost: return "xCat host must be a valid IPv4 address or localhost."
        case let .connect(message): return "Could not connect to OM0RX-xCat: \(message)"
        case .write: return "Could not send a command to OM0RX-xCat."
        case .read: return "OM0RX-xCat closed the command connection."
        case .timeout: return "OM0RX-xCat did not answer before the command timeout."
        case .invalidResponse: return "OM0RX-xCat returned an invalid response."
        }
    }
}

public actor XCatClient {
    public let host: String
    public let port: UInt16

    public init(host: String = "127.0.0.1", port: UInt16 = 14532) {
        self.host = host == "localhost" ? "127.0.0.1" : host
        self.port = port
    }

    public func snapshot() throws -> RadioSnapshot {
        let frequency = try command("f").split(separator: "\n").first.flatMap { Int64($0.trimmingCharacters(in: .whitespaces)) }
        let mode = try command("m").split(separator: "\n").first.map(String.init)
        guard let frequency, let mode, frequency > 0 else { throw XCatClientError.invalidResponse }
        return RadioSnapshot(frequencyHz: frequency, mode: normalizedMode(mode))
    }

    public func stationSnapshot() throws -> XCatStationSnapshot {
        let response = try command("\\get_xcat_state")
        guard let data = response.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(XCatStationSnapshot.self, from: data),
              snapshot.available else { throw XCatClientError.invalidResponse }
        return snapshot
    }

    public func stationAction(_ action: String) throws {
        let normalized = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let safeCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz_0123456789. -")
        guard !normalized.isEmpty,
              normalized.unicodeScalars.allSatisfy(safeCharacters.contains),
              try command("\\xcat_action \(normalized)", timeoutSeconds: 10).contains("RPRT 0") else {
            throw XCatClientError.invalidResponse
        }
    }

    public func tune(frequencyHz: Int64, mode: String) throws {
        let radioMode = radioMode(for: mode, frequencyHz: frequencyHz)
        // A remote station route can legitimately take several seconds while
        // antenna, tuner and amplifier state settle. Keep ordinary telemetry
        // reads at two seconds, but wait for the atomic tune acknowledgement
        // instead of declaring failure while the radio is still changing.
        let combined = try command("\\xcat_tune \(frequencyHz) \(radioMode)", timeoutSeconds: 12)
        if combined.contains("RPRT 0") { return }
        guard combined.contains("RPRT -4") else { throw XCatClientError.invalidResponse }
        guard try command("F \(frequencyHz)").contains("RPRT 0") else { throw XCatClientError.invalidResponse }
        guard try command("M \(radioMode) 0").contains("RPRT 0") else { throw XCatClientError.invalidResponse }
    }

    public func waitForObservedSimplex(frequencyHz: Int64, mode: String) async throws {
        let expectedMode = radioMode(for: mode, frequencyHz: frequencyHz)
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(12))
        repeat {
            try Task.checkCancellation()
            let state = try stationSnapshot()
            if state.radio?.confirmsSimplex(frequencyHz: frequencyHz, radioMode: expectedMode) == true { return }
            try await Task.sleep(for: .milliseconds(100))
        } while clock.now < deadline
        throw XCatClientError.timeout
    }

    private func command(_ command: String, timeoutSeconds: Int = 2) throws -> String {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw XCatClientError.connect(String(cString: strerror(errno))) }
        defer { close(descriptor) }
        var timeout = timeval(tv_sec: timeoutSeconds, tv_usec: 0)
        setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        guard inet_pton(AF_INET, host, &address.sin_addr) == 1 else { throw XCatClientError.invalidHost }
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard result == 0 else { throw XCatClientError.connect(String(cString: strerror(errno))) }
        let payload = Data((command + "\n").utf8)
        let sent = payload.withUnsafeBytes { send(descriptor, $0.baseAddress, $0.count, 0) }
        guard sent == payload.count else { throw XCatClientError.write }
        var bytes = [UInt8](repeating: 0, count: 16_384)
        let count = recv(descriptor, &bytes, bytes.count, 0)
        if count < 0, errno == EAGAIN || errno == EWOULDBLOCK { throw XCatClientError.timeout }
        guard count > 0 else { throw XCatClientError.read }
        return String(decoding: bytes.prefix(count), as: UTF8.self)
    }

    private func normalizedMode(_ response: String) -> String {
        let value = response.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if value.hasPrefix("DIG") { return "FT8" }
        if value == "USB" || value == "LSB" { return "SSB" }
        return value
    }

    private func radioMode(for mode: String, frequencyHz: Int64) -> String {
        switch mode.uppercased() {
        case "SSB": return frequencyHz < 10_000_000 ? "LSB" : "USB"
        case "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI": return "DIGU"
        case "CW": return "CW"
        default: return mode.uppercased()
        }
    }
}
