@preconcurrency import Network
import Foundation

/// A resilient local CAT client for using the installed xCAT as an interim
/// SmartLink transport. OM0RX-xCat remains the stable endpoint presented to
/// RUMlogNG while this client reconnects independently upstream.
public actor LegacyXCATClient: RadioControlling {
    public typealias StateHandler = @Sendable (RadioConnectionState, String) -> Void
    public typealias SnapshotHandler = @Sendable (RadioSnapshot) -> Void

    private let host: String
    private let port: UInt16
    private let onState: StateHandler
    private let onSnapshot: SnapshotHandler
    private let queue = DispatchQueue(label: "com.oliverbross.OM0RXXCat.legacy-xcat")

    private var connection: NWConnection?
    private var generation = 0
    private var shouldRun = false
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var inboundBuffer = Data()
    private var state: RadioConnectionState = .stopped
    private var value: RadioSnapshot
    private var vfoAFrequencyHz: Int64
    private var vfoBFrequencyHz: Int64?
    private var vfoAMode: String
    private var vfoBMode: String?
    private var receiveVFO = 0
    private var transmitVFO = 0
    private var wordsPerMinute = 25

    public init(
        host: String = "127.0.0.1",
        port: UInt16 = 5002,
        onState: @escaping StateHandler = { _, _ in },
        onSnapshot: @escaping SnapshotHandler = { _ in }
    ) {
        self.host = host
        self.port = port
        self.onState = onState
        self.onSnapshot = onSnapshot
        let initial = RadioSnapshot(isConnected: false, station: "xCAT SmartLink")
        value = initial
        vfoAFrequencyHz = initial.frequencyHz
        vfoAMode = initial.mode
    }

    public func start() {
        guard !shouldRun else { return }
        shouldRun = true
        reconnectAttempt = 0
        connect()
    }

    public func stop() async {
        shouldRun = false
        reconnectTask?.cancel()
        reconnectTask = nil
        pollTask?.cancel()
        pollTask = nil
        if state == .ready {
            try? await send("KY                        ;")
            try? await send("RX;")
        }
        generation += 1
        connection?.cancel()
        connection = nil
        inboundBuffer.removeAll(keepingCapacity: false)
        value.isConnected = false
        value.isTransmitting = false
        publishSnapshot()
        transition(.stopped, "Stopped")
    }

    public func reconnectNow() {
        guard shouldRun else {
            start()
            return
        }
        reconnectAttempt = 0
        generation += 1
        connection?.cancel()
        connection = nil
        connect()
    }

    public func snapshot() -> RadioSnapshot { value }
    public func primaryFrequency() -> Int64? { vfoAFrequencyHz }
    public func secondaryFrequency() -> Int64? { vfoBFrequencyHz }
    public func cwSpeed() -> Int { wordsPerMinute }

    public func setPrimaryFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        try await send(String(format: "FA%011lld;", frequencyHz))
        vfoAFrequencyHz = frequencyHz
        refreshSnapshot()
    }

    public func setFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        let command = receiveVFO == 1 ? "FB" : "FA"
        try await send(String(format: "%@%011lld;", command, frequencyHz))
        if receiveVFO == 1 {
            vfoBFrequencyHz = frequencyHz
            if vfoBMode == nil { vfoBMode = vfoAMode }
        } else {
            vfoAFrequencyHz = frequencyHz
        }
        refreshSnapshot()
    }

    public func setSecondaryFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        try await send(String(format: "FB%011lld;", frequencyHz))
        vfoBFrequencyHz = frequencyHz
        if vfoBMode == nil { vfoBMode = vfoAMode }
        refreshSnapshot()
    }

    public func setMode(_ mode: String) async throws {
        guard let code = Self.kenwoodMode(for: mode) else { throw XCatError.invalidMode }
        try await send("MD\(code);")
        if receiveVFO == 1 {
            vfoBMode = mode.uppercased()
        } else {
            vfoAMode = mode.uppercased()
        }
        refreshSnapshot()
    }

    public func setTransmit(_ enabled: Bool) async throws {
        try await send(enabled ? "TX;" : "RX;")
        value.isTransmitting = enabled
        publishSnapshot()
    }

    public func setTransmit(_ mode: CATTransmitMode) async throws {
        let command: String
        switch mode {
        case .microphone: command = "TX0;"
        case .data: command = "TX1;"
        case .tune: command = "TX2;"
        }
        try await send(command)
        value.isTransmitting = true
        publishSnapshot()
    }

    public func setSplitTransmit(_ enabled: Bool) async throws {
        guard !enabled || vfoBFrequencyHz != nil else { throw XCatError.unsupported }
        try await send(enabled ? "FT1;" : "FT0;")
        transmitVFO = enabled ? 1 : 0
        refreshSnapshot()
    }

    public func setReceiveVFO(_ vfo: Int) async throws {
        guard vfo == 0 || vfo == 1 else { throw XCatError.unsupported }
        guard vfo == 0 || vfoBFrequencyHz != nil else { throw XCatError.unsupported }
        try await send("FR\(vfo);")
        receiveVFO = vfo
        refreshSnapshot()
    }

    public func setCWSpeed(_ wordsPerMinute: Int) async throws {
        guard (5...100).contains(wordsPerMinute) else {
            throw XCatError.server("CW speed must be 5 through 100 WPM.")
        }
        try await send(String(format: "KS%03d;", wordsPerMinute))
        self.wordsPerMinute = wordsPerMinute
    }

    public func sendCW(_ text: String) async throws {
        guard !text.isEmpty, text.count <= 128, !text.contains(";") else {
            throw XCatError.server("CW text must contain 1 through 128 safe characters.")
        }
        try await send("KY \(text);")
    }

    public func clearCW() async throws {
        try await send("KY                        ;")
        try? await setTransmit(false)
    }

    private func connect() {
        guard shouldRun, connection == nil else { return }
        generation += 1
        let currentGeneration = generation
        inboundBuffer.removeAll(keepingCapacity: true)
        transition(.connecting, "Connecting to xCAT at \(host):\(port)")

        guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
            transition(.failed, "Invalid xCAT port")
            return
        }
        let newConnection = NWConnection(host: NWEndpoint.Host(host), port: endpointPort, using: .tcp)
        connection = newConnection
        newConnection.stateUpdateHandler = { [weak self] networkState in
            Task { await self?.handle(networkState, generation: currentGeneration) }
        }
        newConnection.start(queue: queue)
    }

    private func handle(_ networkState: NWConnection.State, generation currentGeneration: Int) async {
        guard currentGeneration == generation else { return }
        switch networkState {
        case .ready:
            reconnectAttempt = 0
            transition(.ready, "Remote Flex connected through supervised xCAT")
            receive(generation: currentGeneration)
            startPollLoop(generation: currentGeneration)
        case let .waiting(error):
            connectionFailed("xCAT waiting: \(error.localizedDescription)", generation: currentGeneration)
        case let .failed(error):
            connectionFailed("xCAT connection failed: \(error.localizedDescription)", generation: currentGeneration)
        case .cancelled:
            if shouldRun { connectionFailed("xCAT connection closed", generation: currentGeneration) }
        default:
            break
        }
    }

    private func startPollLoop(generation currentGeneration: Int) {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await self?.send("KS;FB;FA;FR;MD;FT;IF;")
                } catch {
                    await self?.connectionFailed("xCAT polling failed", generation: currentGeneration)
                    return
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func receive(generation currentGeneration: Int) {
        guard currentGeneration == generation, let connection else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8_192) { [weak self] data, _, complete, error in
            Task {
                guard let self else { return }
                if let data, !data.isEmpty { await self.consume(data, generation: currentGeneration) }
                if complete || error != nil {
                    await self.connectionFailed(
                        error.map { "xCAT receive failed: \($0.localizedDescription)" } ?? "xCAT closed the connection",
                        generation: currentGeneration
                    )
                } else {
                    await self.receive(generation: currentGeneration)
                }
            }
        }
    }

    private func consume(_ data: Data, generation currentGeneration: Int) {
        guard currentGeneration == generation else { return }
        inboundBuffer.append(data)
        if inboundBuffer.count > 65_536 {
            inboundBuffer.removeAll(keepingCapacity: true)
            return
        }
        while let delimiter = inboundBuffer.firstIndex(of: Character(";").asciiValue!) {
            let frameData = inboundBuffer[..<delimiter]
            inboundBuffer.removeSubrange(...delimiter)
            guard let frame = String(data: frameData, encoding: .utf8) else { continue }
            parse(frame.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    private func parse(_ frame: String) {
        var changed = false
        if frame.hasPrefix("FA"), let frequency = Int64(frame.dropFirst(2)) {
            vfoAFrequencyHz = frequency
            changed = true
        } else if frame.hasPrefix("FB"), let frequency = Int64(frame.dropFirst(2)) {
            vfoBFrequencyHz = frequency
            if vfoBMode == nil { vfoBMode = vfoAMode }
            changed = true
        } else if frame.hasPrefix("KS"), let speed = Int(frame.dropFirst(2)) {
            wordsPerMinute = speed
            changed = true
        } else if frame.hasPrefix("MD"), let mode = Self.flexMode(forKenwoodCode: String(frame.dropFirst(2))) {
            if receiveVFO == 1 { vfoBMode = mode } else { vfoAMode = mode }
            changed = true
        } else if frame == "FR0" || frame == "FR1" {
            receiveVFO = frame == "FR1" ? 1 : 0
            changed = true
        } else if frame == "FT0" || frame == "FT1" {
            transmitVFO = frame == "FT1" ? 1 : 0
            changed = true
        } else if frame.hasPrefix("IF") {
            changed = true
        }
        if changed {
            value.isConnected = true
            refreshSnapshot()
        }
    }

    private func send(_ command: String) async throws {
        guard state == .ready, let connection else { throw XCatError.notConnected }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            connection.send(content: Data(command.utf8), completion: .contentProcessed { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            })
        }
    }

    private func connectionFailed(_ message: String, generation currentGeneration: Int) {
        guard currentGeneration == generation else { return }
        pollTask?.cancel()
        pollTask = nil
        generation += 1
        connection?.cancel()
        connection = nil
        value.isConnected = false
        value.isTransmitting = false
        publishSnapshot()
        guard shouldRun else {
            transition(.stopped, "Stopped")
            return
        }
        scheduleReconnect(message)
    }

    private func scheduleReconnect(_ message: String) {
        reconnectTask?.cancel()
        reconnectAttempt += 1
        let base = min(pow(2.0, Double(max(0, reconnectAttempt - 1))), 30.0)
        let delay = base + Double.random(in: 0...(base * 0.25))
        transition(.retrying, "\(message). Retrying in \(String(format: "%.1f", delay)) s")
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.connect()
        }
    }

    private func refreshSnapshot() {
        var vfos = [RadioVFO(
            letter: "A",
            frequencyHz: vfoAFrequencyHz,
            mode: vfoAMode,
            isReceive: receiveVFO == 0,
            isTransmit: transmitVFO == 0
        )]
        if let vfoBFrequencyHz {
            vfos.append(RadioVFO(
                letter: "B",
                frequencyHz: vfoBFrequencyHz,
                mode: vfoBMode ?? vfoAMode,
                isReceive: receiveVFO == 1,
                isTransmit: transmitVFO == 1
            ))
        }
        value.vfos = vfos
        let receive = receiveVFO == 1 ? value.vfo("B") : value.vfo("A")
        let transmit = transmitVFO == 1 ? value.vfo("B") : value.vfo("A")
        value.slice = receiveVFO == 1 ? "B" : "A"
        value.transmitSlice = transmitVFO == 1 ? "B" : "A"
        value.frequencyHz = receive?.frequencyHz ?? vfoAFrequencyHz
        value.mode = receive?.mode ?? vfoAMode
        value.transmitFrequencyHz = transmit?.frequencyHz ?? vfoAFrequencyHz
        publishSnapshot()
    }

    private func publishSnapshot() { onSnapshot(value) }

    private func transition(_ newState: RadioConnectionState, _ description: String) {
        state = newState
        onState(newState, description)
    }

    private static func kenwoodMode(for mode: String) -> Int? {
        switch mode.uppercased() {
        case "LSB": 1
        case "USB": 2
        case "CW": 3
        case "FM", "NFM": 4
        case "AM", "SAM": 5
        case "DIGL", "RTTY", "RTTYR": 6
        case "CWR": 7
        case "DIGU", "PKTUSB": 9
        default: nil
        }
    }

    private static func flexMode(forKenwoodCode code: String) -> String? {
        switch code {
        case "1": "LSB"
        case "2": "USB"
        case "3": "CW"
        case "4": "FM"
        case "5": "AM"
        case "6": "DIGL"
        case "7": "CWR"
        case "9": "DIGU"
        default: nil
        }
    }
}
