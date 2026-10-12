@preconcurrency import Network
import Foundation

enum FlexCommandResponseParser {
    struct Response: Equatable {
        let sequence: Int
        let code: UInt32
        let message: String
    }

    static func parse(_ line: String) -> Response? {
        guard line.first == "R" else { return nil }
        let fields = line.dropFirst().split(separator: "|", maxSplits: 3, omittingEmptySubsequences: false)
        guard fields.count >= 2,
              let sequence = Int(fields[0]),
              let code = UInt32(fields[1], radix: 16) else { return nil }
        return Response(sequence: sequence, code: code, message: fields.count >= 3 ? String(fields[2]) : "")
    }
}

public actor FlexRadioClient: RadioControlling {
    public typealias StateHandler = @Sendable (RadioConnectionState, String) -> Void
    public typealias SnapshotHandler = @Sendable (RadioSnapshot) -> Void

    private struct SliceState: Sendable {
        var id: Int
        var frequencyMHz: Double?
        var mode: String?
        var clientHandle: String?
        var indexLetter: String?
        var active = false
        var transmit = false
        var inUse = true
    }

    private struct PendingCommand {
        let continuation: CheckedContinuation<Void, any Error>
        let timeoutTask: Task<Void, Never>
    }

    private let host: String
    private let port: UInt16
    private let stationName: String
    private let sliceLetter: String
    private let wanValidationHandle: String?
    private let certificateIdentity: String?
    private let onState: StateHandler
    private let onSnapshot: SnapshotHandler
    private let queue = DispatchQueue(label: "com.oliverbross.OM0RXXCat.radio")

    private var connection: NWConnection?
    private var generation = 0
    private var shouldRun = false
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var inboundBuffer = Data()
    private var commandSequence = 1
    private var state: RadioConnectionState = .stopped
    private var value: RadioSnapshot
    private var slices: [Int: SliceState] = [:]
    private var selectedSliceID: Int?
    private var followedClientHandle: String?
    private var followedClientID: String?
    private var clientHandleReceived = false
    private var transportReady = false
    private var pendingCommands: [Int: PendingCommand] = [:]
    private var wordsPerMinute = 25
    private var reportedClientHandles: Set<String> = []
    private var reportedSliceIDs: Set<Int> = []

    public init(
        host: String,
        port: UInt16 = 4992,
        stationName: String,
        sliceLetter: String = "A",
        wanValidationHandle: String? = nil,
        certificateIdentity: String? = nil,
        onState: @escaping StateHandler = { _, _ in },
        onSnapshot: @escaping SnapshotHandler = { _ in }
    ) {
        self.host = host
        self.port = port
        self.stationName = stationName
        self.sliceLetter = sliceLetter.uppercased()
        self.wanValidationHandle = wanValidationHandle
        self.certificateIdentity = certificateIdentity
        self.onState = onState
        self.onSnapshot = onSnapshot
        value = RadioSnapshot(isConnected: false, slice: sliceLetter.uppercased(), station: stationName)
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
        pingTask?.cancel()
        pingTask = nil
        if transportReady {
            try? await sendCommand("transmit tune 0", timeout: .seconds(1))
            try? await sendCommand("cwx clear", timeout: .seconds(1))
            try? await sendCommand("xmit 0", timeout: .seconds(1))
        }
        generation += 1
        connection?.cancel()
        connection = nil
        failAllPending(XCatError.notConnected)
        inboundBuffer.removeAll(keepingCapacity: false)
        value.isConnected = false
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

    public func snapshot() -> RadioSnapshot {
        value
    }

    public func primaryFrequency() -> Int64? {
        guard let frequencyMHz = stationSlice(letter: "A")?.frequencyMHz else { return nil }
        return Int64((frequencyMHz * 1_000_000).rounded())
    }

    public func setPrimaryFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        guard let slice = stationSlice(letter: "A") else { throw XCatError.notConnected }
        try await sendCommand("slice t \(slice.id) \(Self.formatMHz(frequencyHz))")
    }

    public func setFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        guard let selectedSliceID else { throw XCatError.notConnected }
        try await sendCommand("slice t \(selectedSliceID) \(Self.formatMHz(frequencyHz))")
    }

    public func setMode(_ mode: String) async throws {
        let normalized = mode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty, normalized.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) else {
            throw XCatError.invalidMode
        }
        guard let selectedSliceID else { throw XCatError.notConnected }
        try await sendCommand("slice s \(selectedSliceID) mode=\(normalized)")
    }

    public func secondaryFrequency() -> Int64? {
        guard let frequencyMHz = stationSlice(letter: "B")?.frequencyMHz else { return nil }
        return Int64((frequencyMHz * 1_000_000).rounded())
    }

    public func setSecondaryFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        guard let slice = stationSlice(letter: "B") else { throw XCatError.unsupported }
        try await sendCommand("slice t \(slice.id) \(Self.formatMHz(frequencyHz))")
    }

    public func setSplitTransmit(_ enabled: Bool) async throws {
        let letter = enabled ? "B" : "A"
        guard let slice = stationSlice(letter: letter) else { throw XCatError.unsupported }
        try await sendCommand("slice s \(slice.id) tx=1")
    }

    public func setReceiveVFO(_ vfo: Int) async throws {
        guard vfo == 0 || vfo == 1 else { throw XCatError.unsupported }
        let letter = vfo == 0 ? "A" : "B"
        guard let slice = stationSlice(letter: letter) else { throw XCatError.unsupported }
        try await sendCommand("slice s \(slice.id) active=1")
    }

    public func setTransmit(_ enabled: Bool) async throws {
        guard transportReady else { throw XCatError.notConnected }
        if enabled {
            guard state == .ready, value.isConnected, selectedSliceID != nil else { throw XCatError.notConnected }
        }
        if !enabled { try await sendCommand("transmit tune 0") }
        try await sendCommand("xmit \(enabled ? 1 : 0)")
    }

    public func cwSpeed() -> Int { wordsPerMinute }

    public func setCWSpeed(_ wordsPerMinute: Int) async throws {
        guard (5...100).contains(wordsPerMinute) else { throw XCatError.server("CW speed must be 5 through 100 WPM.") }
        try await sendCommand("cw wpm \(wordsPerMinute)")
        self.wordsPerMinute = wordsPerMinute
    }

    public func sendCW(_ text: String) async throws {
        let safeText = text.unicodeScalars.map { scalar -> Character in
            (scalar.value >= 0x20 && scalar.value <= 0x7E && scalar != "|") ? Character(scalar) : " "
        }
        let sanitized = String(safeText)
        guard !sanitized.trimmingCharacters(in: .whitespaces).isEmpty, sanitized.count <= 128 else {
            throw XCatError.server("CW text must contain 1 through 128 printable characters.")
        }
        try await sendCommand("cwx send \(sanitized)")
    }

    public func clearCW() async throws {
        try await sendCommand("cwx clear")
        try? await setTransmit(false)
    }

    public func addSpot(_ spot: FlexSpot) async throws {
        func encoded(_ value: String) -> String {
            value.replacingOccurrences(of: " ", with: "\u{7F}")
        }
        let frequency = String(format: "%.6f", Double(spot.frequencyHz) / 1_000_000)
        let command = [
            "spot add",
            "rx_freq=\(frequency)",
            "callsign=\(encoded(spot.callsign))",
            "mode=\(encoded(spot.mode))",
            "source=\(encoded(spot.source))",
            "spotter_callsign=\(encoded(spot.spotter))",
            "timestamp=\(spot.timestamp)",
            "lifetime_seconds=\(spot.lifetimeSeconds)",
            "priority=\(spot.priority)",
            "comment=\(encoded(spot.comment))",
            "color=\(spot.colorHex)",
        ].joined(separator: " ")
        try await sendCommand(command)
    }

    public func setTransmit(_ mode: CATTransmitMode) async throws {
        guard state == .ready, value.isConnected, selectedSliceID != nil else { throw XCatError.notConnected }
        switch mode {
        case .microphone, .data:
            try await setTransmit(true)
        case .tune:
            try await sendCommand("transmit tune 1")
        }
    }

    private func connect() {
        guard shouldRun, connection == nil else { return }
        generation += 1
        let currentGeneration = generation
        resetSessionState()
        transition(.connecting, "Connecting to \(host):\(port)")

        guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
            transition(.failed, "Invalid radio port")
            return
        }
        let parameters: NWParameters
        if wanValidationHandle != nil {
            let tls = NWProtocolTLS.Options()
            let pinStore = SmartLinkCertificatePinStore()
            let pinIdentity = certificateIdentity ?? host
            sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, trust, complete in
                let secTrust = sec_trust_copy_ref(trust).takeRetainedValue()
                guard let certificates = SecTrustCopyCertificateChain(secTrust) as? [SecCertificate],
                      let certificate = certificates.first else {
                    complete(false)
                    return
                }
                let data = SecCertificateCopyData(certificate) as Data
                complete(pinStore.verifyOrTrustFirstUse(identity: pinIdentity, certificateData: data))
            }, queue)
            parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
        } else {
            parameters = .tcp
        }
        let newConnection = NWConnection(host: NWEndpoint.Host(host), port: endpointPort, using: parameters)
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
            transportReady = true
            transition(.connecting, wanValidationHandle == nil ? "Connected; starting radio session" : "Secure transport connected; validating SmartLink session")
            receive(generation: currentGeneration)
            do {
                if let wanValidationHandle {
                    try await sendCommand("wan validate handle=\(wanValidationHandle)")
                    try await waitForWANValidation()
                }
                try await bootstrap()
                transition(.ready, "Connected; waiting for \(stationName) slice \(sliceLetter)")
                startPingLoop(generation: currentGeneration)
            } catch {
                await connectionFailed("Bootstrap failed: \(error.localizedDescription)", generation: currentGeneration)
            }
        case let .waiting(error):
            await connectionFailed("Network waiting: \(error.localizedDescription)", generation: currentGeneration)
        case let .failed(error):
            await connectionFailed("Connection failed: \(error.localizedDescription)", generation: currentGeneration)
        case .cancelled:
            if shouldRun, currentGeneration == generation {
                await connectionFailed("Connection closed", generation: currentGeneration)
            }
        default:
            break
        }
    }

    private func bootstrap() async throws {
        for command in [
            "sub client all",
            "sub slice all",
            "sub radio all",
            "keepalive enable",
            "slice list",
            "ping",
        ] {
            do {
                try await sendCommand(command)
            } catch {
                throw XCatError.server("\(command): \(error.localizedDescription)")
            }
        }
    }

    private func startPingLoop(generation currentGeneration: Int) {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                do {
                    try await self?.sendCommand("ping")
                } catch {
                    await self?.connectionFailed("Radio heartbeat failed", generation: currentGeneration)
                    return
                }
            }
        }
    }

    private func receive(generation currentGeneration: Int) {
        guard currentGeneration == generation, let connection else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, complete, error in
            Task {
                guard let self else { return }
                if let data, !data.isEmpty {
                    await self.consume(data, generation: currentGeneration)
                }
                if complete || error != nil {
                    await self.connectionFailed(
                        error.map { "Receive failed: \($0.localizedDescription)" } ?? "Radio closed the connection",
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
        if inboundBuffer.count > 1_048_576 {
            inboundBuffer.removeAll(keepingCapacity: true)
            return
        }
        while let newline = inboundBuffer.firstIndex(of: 0x0A) {
            let lineData = inboundBuffer[..<newline]
            inboundBuffer.removeSubrange(...newline)
            guard let line = String(data: lineData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !line.isEmpty else { continue }
            parse(line)
        }
    }

    private func parse(_ line: String) {
        if line.first == "R" {
            completeCommand(from: line)
            return
        }
        if line.first == "H" {
            clientHandleReceived = true
            return
        }
        guard line.first == "S" else { return }
        let payload = line.dropFirst()
        let statusParts = payload.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false)
        guard statusParts.count == 2 else { return }
        let body = String(statusParts[1])
        let tokens = body.split(separator: " ")
        guard let object = tokens.first else { return }

        var identifier: String?
        var propertyStart = 1
        if tokens.count > 1, !tokens[1].contains("=") {
            identifier = String(tokens[1])
            propertyStart = 2
        }
        var properties: [String: String] = [:]
        for token in tokens.dropFirst(propertyStart) {
            let pair = token.split(separator: "=", maxSplits: 1).map(String.init)
            if pair.count == 2 { properties[pair[0]] = pair[1] }
        }

        switch object {
        case "client", "gui_client":
            applyClient(identifier: identifier, properties: properties)
        case "slice":
            applySlice(identifier: identifier, properties: properties)
        case "interlock":
            if let interlock = properties["state"]?.uppercased() {
                value.isTransmitting = interlock == "TRANSMITTING" || interlock == "PTT_REQUESTED"
                publishSnapshot()
            }
        case "cwx":
            if let speed = properties["wpm"].flatMap(Int.init), (5...100).contains(speed) {
                wordsPerMinute = speed
            }
        default:
            break
        }
    }

    private func applyClient(identifier: String?, properties: [String: String]) {
        if let handle = Self.normalizedHandle(identifier ?? properties["handle"]),
           reportedClientHandles.insert(handle).inserted {
            let observedStation = properties["station"].map(Self.displayStation) ?? "unnamed"
            let program = properties["program"] ?? "unknown program"
            onState(.connecting, "Found station \(observedStation) (\(program))")
        }
        if properties["removed"] == "1" || properties.keys.contains("removed") {
            if Self.normalizedHandle(identifier ?? properties["handle"]) == followedClientHandle {
                followedClientHandle = nil
                followedClientID = nil
                selectedSliceID = nil
                value.isConnected = false
                publishSnapshot()
                transition(.connecting, "Waiting for station \(stationName)")
            }
            return
        }
        guard Self.normalizedStation(properties["station"]) == Self.normalizedStation(stationName) else { return }
        let newClientID = properties["client_id"]
        let shouldBind = newClientID != nil && newClientID != followedClientID
        followedClientHandle = Self.normalizedHandle(identifier ?? properties["handle"])
        followedClientID = newClientID ?? followedClientID
        if shouldBind, let followedClientID {
            Task { try? await sendCommand("client bind client_id=\(followedClientID)") }
        }
        selectBestSlice()
    }

    private func applySlice(identifier: String?, properties: [String: String]) {
        guard let identifier, let id = Int(identifier) else { return }
        if properties["removed"] == "1" || properties.keys.contains("removed") {
            slices.removeValue(forKey: id)
            if selectedSliceID == id { selectedSliceID = nil }
            selectBestSlice()
            return
        }
        var slice = slices[id] ?? SliceState(id: id)
        if let frequency = properties["RF_frequency"].flatMap(Double.init) ?? properties["freq"].flatMap(Double.init) {
            slice.frequencyMHz = frequency
        }
        if let mode = properties["mode"] { slice.mode = mode.uppercased() }
        if let handle = properties["client_handle"] { slice.clientHandle = Self.normalizedHandle(handle) }
        if let letter = properties["index_letter"] { slice.indexLetter = letter.uppercased() }
        if let active = properties["active"] { slice.active = active == "1" || active.uppercased() == "T" }
        if let transmit = properties["tx"] { slice.transmit = transmit == "1" || transmit.uppercased() == "T" }
        if let inUse = properties["in_use"] { slice.inUse = inUse == "1" || inUse.uppercased() == "T" }
        slices[id] = slice
        if reportedSliceIDs.insert(id).inserted {
            let letter = slice.indexLetter ?? "?"
            let frequency = slice.frequencyMHz.map { String(format: "%.6f MHz", $0) } ?? "unknown frequency"
            let roles = [slice.active ? "RX" : nil, slice.transmit ? "TX" : nil].compactMap { $0 }.joined(separator: "+")
            onState(.ready, "Found VFO \(letter) at \(frequency)\(roles.isEmpty ? "" : " (\(roles))")")
        }
        selectBestSlice()
    }

    private func selectBestSlice() {
        guard let followedClientHandle else { return }
        let candidates = slices.values.filter { slice in
            slice.clientHandle == followedClientHandle && slice.inUse && slice.frequencyMHz != nil
        }
        let selected = candidates.sorted { lhs, rhs in
            if lhs.active != rhs.active { return lhs.active }
            if lhs.indexLetter == sliceLetter, rhs.indexLetter != sliceLetter { return true }
            if lhs.indexLetter != sliceLetter, rhs.indexLetter == sliceLetter { return false }
            if lhs.transmit != rhs.transmit { return lhs.transmit }
            return lhs.id < rhs.id
        }.first
        guard let selected, let frequencyMHz = selected.frequencyMHz else {
            selectedSliceID = nil
            if value.isConnected {
                value.isConnected = false
                publishSnapshot()
            }
            return
        }
        selectedSliceID = selected.id
        value.frequencyHz = Int64((frequencyMHz * 1_000_000).rounded())
        if let mode = selected.mode { value.mode = mode }
        value.slice = selected.indexLetter ?? sliceLetter
        let transmit = candidates.filter(\.transmit).sorted { lhs, rhs in
            if lhs.indexLetter != rhs.indexLetter {
                return (lhs.indexLetter ?? "~") < (rhs.indexLetter ?? "~")
            }
            return lhs.id < rhs.id
        }.first ?? selected
        value.transmitSlice = transmit.indexLetter ?? value.slice
        value.transmitFrequencyHz = transmit.frequencyMHz
            .map { Int64(($0 * 1_000_000).rounded()) }
            ?? value.frequencyHz
        value.vfos = candidates.compactMap { slice in
            guard let frequencyMHz = slice.frequencyMHz,
                  let letter = slice.indexLetter else { return nil }
            return RadioVFO(
                letter: letter,
                frequencyHz: Int64((frequencyMHz * 1_000_000).rounded()),
                mode: slice.mode ?? "?",
                isReceive: slice.id == selected.id,
                isTransmit: slice.id == transmit.id
            )
        }.sorted { $0.letter < $1.letter }
        value.station = stationName
        value.isConnected = true
        reconnectAttempt = 0
        publishSnapshot()
    }

    private func stationSlice(letter: String) -> SliceState? {
        guard let followedClientHandle else { return nil }
        return slices.values.first { slice in
            slice.clientHandle == followedClientHandle && slice.indexLetter == letter && slice.inUse
        }
    }

    private func publishSnapshot() {
        onSnapshot(value)
    }

    private func sendCommand(_ body: String, timeout: Duration = .seconds(5)) async throws {
        guard transportReady, let connection else { throw XCatError.notConnected }
        let sequence = commandSequence
        commandSequence += 1
        let command = "C\(sequence)|\(body)\n"
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            let timeoutTask = Task { [weak self] in
                try? await Task.sleep(for: timeout)
                guard !Task.isCancelled else { return }
                await self?.commandTimedOut(sequence)
            }
            pendingCommands[sequence] = PendingCommand(continuation: continuation, timeoutTask: timeoutTask)
            connection.send(content: Data(command.utf8), completion: .contentProcessed { error in
                if let error {
                    Task { [self] in await self.failCommand(sequence, error: error) }
                }
            })
        }
    }

    private func completeCommand(from line: String) {
        guard let response = FlexCommandResponseParser.parse(line),
              let pending = pendingCommands.removeValue(forKey: response.sequence) else { return }
        pending.timeoutTask.cancel()
        if response.code == 0 {
            pending.continuation.resume()
        } else {
            let message = !response.message.isEmpty
                ? response.message
                : String(format: "Radio rejected command (0x%08X).", response.code)
            pending.continuation.resume(throwing: XCatError.server(message))
        }
    }

    private func commandTimedOut(_ sequence: Int) {
        guard let pending = pendingCommands.removeValue(forKey: sequence) else { return }
        pending.continuation.resume(throwing: XCatError.server("Radio command \(sequence) timed out."))
    }

    private func failCommand(_ sequence: Int, error: any Error) {
        guard let pending = pendingCommands.removeValue(forKey: sequence) else { return }
        pending.timeoutTask.cancel()
        pending.continuation.resume(throwing: error)
    }

    private func failAllPending(_ error: any Error) {
        let pending = pendingCommands.values
        pendingCommands.removeAll(keepingCapacity: true)
        for command in pending {
            command.timeoutTask.cancel()
            command.continuation.resume(throwing: error)
        }
    }

    private func connectionFailed(_ message: String, generation currentGeneration: Int) async {
        guard currentGeneration == generation else { return }
        pingTask?.cancel()
        pingTask = nil
        generation += 1
        connection?.cancel()
        connection = nil
        failAllPending(XCatError.notConnected)
        value.isConnected = false
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
        let jitter = Double.random(in: 0...(base * 0.25))
        let delay = base + jitter
        transition(.retrying, "\(message). Retrying in \(String(format: "%.1f", delay)) s")
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.connect()
        }
    }

    private func resetSessionState() {
        pingTask?.cancel()
        pingTask = nil
        inboundBuffer.removeAll(keepingCapacity: true)
        commandSequence = 1
        slices.removeAll(keepingCapacity: true)
        selectedSliceID = nil
        followedClientHandle = nil
        followedClientID = nil
        clientHandleReceived = false
        reportedClientHandles.removeAll(keepingCapacity: true)
        reportedSliceIDs.removeAll(keepingCapacity: true)
        transportReady = false
        failAllPending(XCatError.notConnected)
    }

    private func transition(_ newState: RadioConnectionState, _ description: String) {
        state = newState
        onState(newState, description)
    }

    private static func normalizedHandle(_ value: String?) -> String? {
        guard var value = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !value.isEmpty else {
            return nil
        }
        if value.hasPrefix("0x") { value.removeFirst(2) }
        let normalized = value.drop(while: { $0 == "0" })
        return normalized.isEmpty ? "0" : String(normalized)
    }

    private static func normalizedStation(_ value: String?) -> String {
        displayStation(value ?? "")
            .lowercased()
    }

    private static func displayStation(_ value: String) -> String {
        value
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "\u{7F}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func formatMHz(_ hertz: Int64) -> String {
        String(format: "%.6f", Double(hertz) / 1_000_000)
    }

    private func waitForWANValidation() async throws {
        for _ in 0..<80 {
            if clientHandleReceived { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw XCatError.server("The remote radio did not validate the SmartLink session.")
    }
}
