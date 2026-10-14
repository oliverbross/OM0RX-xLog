import Foundation

struct PendingRadioWrites: Sendable {
    private struct Value<T: Equatable & Sendable>: Sendable {
        let value: T
        let expiresAt: Date
    }

    private var frequencies: [String: Value<Int64>] = [:]
    private var modes: [String: Value<String>] = [:]
    private let lifetime: TimeInterval

    init(lifetime: TimeInterval = 10) {
        self.lifetime = lifetime
    }

    mutating func expectFrequency(_ frequencyHz: Int64, vfo: String, now: Date = Date()) {
        frequencies[vfo.uppercased()] = Value(value: frequencyHz, expiresAt: now.addingTimeInterval(lifetime))
    }

    mutating func expectMode(_ mode: String, vfo: String, now: Date = Date()) {
        modes[vfo.uppercased()] = Value(value: mode.uppercased(), expiresAt: now.addingTimeInterval(lifetime))
    }

    mutating func cancelFrequency(vfo: String) {
        frequencies.removeValue(forKey: vfo.uppercased())
    }

    mutating func reconcile(_ snapshot: inout RadioSnapshot, now: Date = Date()) {
        var completedFrequencies: [String] = []
        for (letter, pending) in frequencies {
            guard let index = snapshot.vfos.firstIndex(where: { $0.letter == letter }) else {
                if now >= pending.expiresAt { completedFrequencies.append(letter) }
                continue
            }
            if snapshot.vfos[index].frequencyHz == pending.value {
                completedFrequencies.append(letter)
            } else if now < pending.expiresAt {
                snapshot.vfos[index].frequencyHz = pending.value
                if snapshot.slice == letter { snapshot.frequencyHz = pending.value }
            } else {
                completedFrequencies.append(letter)
            }
        }
        completedFrequencies.forEach { frequencies.removeValue(forKey: $0) }

        var completedModes: [String] = []
        for (letter, pending) in modes {
            guard let index = snapshot.vfos.firstIndex(where: { $0.letter == letter }) else {
                if now >= pending.expiresAt { completedModes.append(letter) }
                continue
            }
            if snapshot.vfos[index].mode.uppercased() == pending.value {
                completedModes.append(letter)
            } else if now < pending.expiresAt {
                snapshot.vfos[index].mode = pending.value
                if snapshot.slice == letter { snapshot.mode = pending.value }
            } else {
                completedModes.append(letter)
            }
        }
        completedModes.forEach { modes.removeValue(forKey: $0) }
    }
}

public actor RemoteAgentClient: RadioControlling {
    public typealias StateHandler = @Sendable (RadioConnectionState, String) -> Void
    public typealias SnapshotHandler = @Sendable (RadioSnapshot) -> Void

    private let endpoint: RemoteAgentEndpoint
    private let token: String
    private let session: URLSession
    private let enableStream: Bool
    private let onState: StateHandler
    private let onSnapshot: SnapshotHandler
    private let onObservedSnapshot: SnapshotHandler

    private var value = RadioSnapshot(
        isConnected: false,
        station: "Remote Agent",
        remoteStationStatus: RemoteStationStatus()
    )
    private var authoritativeValue = RadioSnapshot(
        isConnected: false,
        station: "Remote Agent",
        remoteStationStatus: RemoteStationStatus()
    )
    private var wordsPerMinute = 25
    private var shouldRun = false
    private var generation = 0
    private var reconnectAttempt = 0
    private var webSocket: URLSessionWebSocketTask?
    private var streamTask: Task<Void, Never>?
    private var watchdogTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var lastStreamMessage = Date.distantPast
    private var pendingWrites = PendingRadioWrites()
    private var frequencyVerificationTasks: [String: Task<Void, Never>] = [:]
    private var frequencyVerificationIDs: [String: UUID] = [:]

    public init(
        baseURL: String,
        token: String,
        session: URLSession = .shared,
        onState: @escaping StateHandler = { _, _ in },
        onSnapshot: @escaping SnapshotHandler = { _ in },
        onObservedSnapshot: @escaping SnapshotHandler = { _ in },
        enableStream: Bool = true
    ) throws {
        endpoint = try RemoteAgentEndpoint(baseURL)
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedToken.isEmpty else {
            throw XCatError.server("Enter the Remote Agent bearer token.")
        }
        self.token = trimmedToken
        self.session = session
        self.enableStream = enableStream
        self.onState = onState
        self.onSnapshot = onSnapshot
        self.onObservedSnapshot = onObservedSnapshot
    }

    public func start() {
        guard !shouldRun else { return }
        shouldRun = true
        reconnectAttempt = 0
        Task { await connect() }
    }

    public func stop() {
        shouldRun = false
        generation += 1
        retirePendingWrites()
        reconnectTask?.cancel()
        reconnectTask = nil
        streamTask?.cancel()
        streamTask = nil
        watchdogTask?.cancel()
        watchdogTask = nil
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        markDisconnected("Stopped")
        transition(.stopped, "Stopped")
    }

    /// Re-establish the read-only HTTPS/WebSocket session without invoking
    /// any station command or the application's transmit-recovery stop path.
    public func reconnectNow() {
        guard shouldRun else {
            start()
            return
        }
        reconnectAttempt = 0
        generation += 1
        retirePendingWrites()
        reconnectTask?.cancel()
        reconnectTask = nil
        streamTask?.cancel()
        streamTask = nil
        watchdogTask?.cancel()
        watchdogTask = nil
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        markDisconnected("Manual reconnect requested")
        Task { await connect() }
    }

    public func snapshot() -> RadioSnapshot { value }
    public func observedSnapshot() -> RadioSnapshot {
        var observed = authoritativeValue
        observed.isConnected = observed.isConnected && shouldRun && value.isConnected
        return observed
    }
    public func primaryFrequency() -> Int64? { value.vfo("A")?.frequencyHz }
    public func secondaryFrequency() -> Int64? { value.vfo("B")?.frequencyHz }
    public func cwSpeed() -> Int { wordsPerMinute }

    public func setPrimaryFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        try await execute(.frequency(frequencyHz, vfo: "A"))
        pendingWrites.expectFrequency(frequencyHz, vfo: "A")
        publishPendingWrites()
        scheduleFrequencyVerification(frequencyHz, vfo: "A")
    }

    public func setFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        let vfo = receiveVFO()
        try await execute(.frequency(frequencyHz, vfo: vfo))
        pendingWrites.expectFrequency(frequencyHz, vfo: vfo)
        publishPendingWrites()
        scheduleFrequencyVerification(frequencyHz, vfo: vfo)
    }

    public func setFrequencyAndMode(_ frequencyHz: Int64, mode: String) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        let normalized = mode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else { throw XCatError.invalidMode }
        let vfo = receiveVFO()
        try await execute(.frequencyAndMode(frequencyHz, mode: normalized, vfo: vfo))
        pendingWrites.expectFrequency(frequencyHz, vfo: vfo)
        pendingWrites.expectMode(normalized, vfo: vfo)
        publishPendingWrites()
        scheduleFrequencyVerification(frequencyHz, vfo: vfo)
    }

    public func tuneSimplex(_ frequencyHz: Int64, mode: String) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        let normalized = mode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else { throw XCatError.invalidMode }
        guard value.remoteStationStatus?.supportedCommands.contains("tune_simplex") == true else {
            try await tuneSimplexLegacy(frequencyHz, mode: normalized)
            return
        }
        // Keep the existing one-request fast path for an already-simplex A.
        if value.slice.uppercased() == "A", value.transmitSlice.uppercased() == "A" {
            try await setFrequencyAndMode(frequencyHz, mode: normalized)
            return
        }
        try await execute(.tuneSimplex(frequencyHz, mode: normalized))
        pendingWrites.expectFrequency(frequencyHz, vfo: "A")
        pendingWrites.expectMode(normalized, vfo: "A")
        publishPendingWrites()
        scheduleFrequencyVerification(frequencyHz, vfo: "A")
    }

    public func setSecondaryFrequency(_ frequencyHz: Int64) async throws {
        guard frequencyHz > 0 else { throw XCatError.invalidFrequency }
        try await execute(.frequency(frequencyHz, vfo: "B"))
        pendingWrites.expectFrequency(frequencyHz, vfo: "B")
        publishPendingWrites()
        scheduleFrequencyVerification(frequencyHz, vfo: "B")
    }

    public func setMode(_ mode: String) async throws {
        let normalized = mode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else { throw XCatError.invalidMode }
        let vfo = receiveVFO()
        try await execute(.mode(normalized, vfo: vfo))
        pendingWrites.expectMode(normalized, vfo: vfo)
        publishPendingWrites()
    }

    public func setTransmit(_ enabled: Bool) async throws {
        try await execute(.ptt(enabled))
    }

    public func setTransmit(_ mode: CATTransmitMode) async throws {
        switch mode {
        case .microphone, .data:
            try await execute(.ptt(true))
        case .tune:
            try await performStationAction(.tune)
        }
    }

    public func setSplitTransmit(_ enabled: Bool) async throws {
        let frequency = enabled ? value.vfo("B")?.frequencyHz : nil
        try await execute(.split(enabled, txFrequencyHz: frequency))
    }

    public func setReceiveVFO(_ vfo: Int) async throws {
        guard vfo == 0 || vfo == 1 else { throw XCatError.unsupported }
        try await execute(.receiveVFO(vfo == 0 ? "A" : "B"))
    }

    public func setCWSpeed(_ wordsPerMinute: Int) async throws {
        guard (5...100).contains(wordsPerMinute) else {
            throw XCatError.server("CW speed must be 5 through 100 WPM.")
        }
        try await execute(.cwSpeed(wordsPerMinute))
    }

    public func sendCW(_ text: String) async throws {
        guard !text.isEmpty,
              text.count <= 128,
              !text.contains("|"),
              text.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else {
            throw XCatError.server("CW text must contain 1 through 128 printable ASCII characters without |.")
        }
        try await execute(.sendCW(text))
    }

    public func clearCW() async throws {
        try await execute(.clearCW)
    }

    public func setRIT(enabled: Bool, offsetHz: Int, vfo: String?) async throws {
        guard (-9_999...9_999).contains(offsetHz) else {
            throw XCatError.server("RIT offset must be between -9999 and 9999 Hz.")
        }
        try await execute(.offset(
            kind: "set_rit",
            enabled: enabled,
            offsetHz: offsetHz,
            vfo: normalizedVFO(vfo) ?? receiveVFO()
        ))
    }

    public func setXIT(enabled: Bool, offsetHz: Int, vfo: String?) async throws {
        guard (-9_999...9_999).contains(offsetHz) else {
            throw XCatError.server("XIT offset must be between -9999 and 9999 Hz.")
        }
        try await execute(.offset(
            kind: "set_xit",
            enabled: enabled,
            offsetHz: offsetHz,
            vfo: normalizedVFO(vfo) ?? receiveVFO()
        ))
    }

    public func setRFPower(_ watts: Int) async throws {
        guard watts > 0 else { throw XCatError.server("RF power must be greater than zero.") }
        try await execute(.rfPower(watts))
    }

    public func performStationAction(_ action: RemoteStationAction) async throws {
        try await execute(.station(action))
    }

    public func addSpot(_ spot: FlexSpot) async throws {
        try await execute(.addSpot(spot), expectedSpot: spot)
    }

    public func fetchConfiguration() async throws -> RemoteStationConfiguration {
        let request = endpoint.httpRequest(path: "/api/v1/config", token: token)
        let (data, response) = try await session.data(for: request)
        try Self.validate(response: response, data: data)
        let decoded = try JSONDecoder().decode(RemoteConfigResponse.self, from: data)
        guard decoded.success else { throw XCatError.server("Remote Agent rejected the configuration request.") }
        return decoded.config
    }

    public func saveConfiguration(_ configuration: RemoteStationConfiguration) async throws -> RemoteStationConfiguration {
        var request = endpoint.httpRequest(path: "/api/v1/config", token: token, method: "PUT")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RemoteConfigUpdateRequest(config: configuration))
        let (data, response) = try await session.data(for: request)
        try Self.validate(response: response, data: data)
        let decoded = try JSONDecoder().decode(RemoteConfigResponse.self, from: data)
        guard decoded.success else { throw XCatError.server("Remote Agent rejected the configuration update.") }
        return decoded.config
    }

    /// Validate the known schema without re-encoding it: newer agent fields
    /// must survive a load/edit/save round trip through an older desktop.
    public static func configurationData(fromResponse data: Data) throws -> Data {
        guard data.count <= 65_536 else { throw XCatError.server("Remote configuration response is too large.") }
        let decoded = try JSONDecoder().decode(RemoteConfigResponse.self, from: data)
        guard decoded.success,
              let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let configuration = envelope["config"] as? [String: Any] else {
            throw XCatError.server("Remote Agent rejected the configuration response.")
        }
        let raw = try JSONSerialization.data(withJSONObject: configuration)
        guard raw.count <= 32_768 else { throw XCatError.server("Remote configuration is too large.") }
        return raw
    }

    public static func configurationRequestBody(_ data: Data) throws -> Data {
        guard data.count <= 32_768,
              let configuration = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw XCatError.server("Remote configuration is too large or invalid.")
        }
        _ = try JSONDecoder().decode(RemoteStationConfiguration.self, from: data)
        return try JSONSerialization.data(withJSONObject: ["config": configuration])
    }

    public func fetchConfigurationData() async throws -> Data {
        let request = endpoint.httpRequest(path: "/api/v1/config", token: token)
        let (data, response) = try await session.data(for: request)
        try Self.validate(response: response, data: data)
        return try Self.configurationData(fromResponse: data)
    }

    public func saveConfigurationData(_ configuration: Data) async throws -> Data {
        var request = endpoint.httpRequest(path: "/api/v1/config", token: token, method: "PUT")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.configurationRequestBody(configuration)
        let (data, response) = try await session.data(for: request)
        try Self.validate(response: response, data: data)
        return try Self.configurationData(fromResponse: data)
    }

    private func connect() async {
        guard shouldRun else { return }
        generation += 1
        let currentGeneration = generation
        transition(.connecting, "Connecting to Remote Station Agent")
        do {
            let decoded = try await fetchState()
            guard currentGeneration == generation, shouldRun else { return }
            apply(decoded)
            reconnectAttempt = 0
            transition(.ready, "Remote Station Agent connected")
            openStream(generation: currentGeneration)
        } catch {
            connectionFailed(error.localizedDescription, generation: currentGeneration)
        }
    }

    private func fetchState() async throws -> RemoteAgentDecodedState {
        let request = endpoint.httpRequest(path: "/api/v1/state", token: token)
        let (data, response) = try await session.data(for: request)
        let receivedAt = Date()
        try Self.validate(response: response, data: data)
        return try RemoteAgentStateDecoder.stateResponse(data, receivedAt: receivedAt)
    }

    private func openStream(generation currentGeneration: Int) {
        // HTTP-only clients can supply an isolated transport without opening a socket.
        guard enableStream else { return }
        let socket = session.webSocketTask(with: endpoint.webSocketRequest(token: token))
        webSocket = socket
        lastStreamMessage = Date()
        socket.resume()
        streamTask?.cancel()
        streamTask = Task { [weak self] in
            await self?.receiveStream(socket, generation: currentGeneration)
        }
        watchdogTask?.cancel()
        watchdogTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { return }
                await self?.checkStreamFreshness(generation: currentGeneration)
            }
        }
    }

    private func receiveStream(_ socket: URLSessionWebSocketTask, generation currentGeneration: Int) async {
        do {
            while shouldRun, currentGeneration == generation, !Task.isCancelled {
                let message = try await socket.receive()
                // The actor can reconnect or stop while receive is suspended.
                guard shouldRun, currentGeneration == generation, !Task.isCancelled else { return }
                let receivedAt = Date()
                lastStreamMessage = receivedAt
                let data: Data
                switch message {
                case let .data(value): data = value
                case let .string(value): data = Data(value.utf8)
                @unknown default: continue
                }
                if let decoded = try RemoteAgentStateDecoder.streamMessage(data, receivedAt: receivedAt) { apply(decoded) }
            }
        } catch {
            connectionFailed("Remote Agent stream interrupted: \(error.localizedDescription)", generation: currentGeneration)
        }
    }

    func checkStreamFreshness(generation currentGeneration: Int, at now: Date = Date()) {
        guard currentGeneration == generation, shouldRun else { return }
        if now.timeIntervalSince(lastStreamMessage) > 35 {
            connectionFailed("Remote Agent stream heartbeat timed out", generation: currentGeneration)
        }
    }

    private func execute(_ command: RemoteAgentCommand, expectedSpot: FlexSpot? = nil) async throws {
        guard shouldRun else { throw XCatError.notConnected }
        let commandGeneration = generation
        guard value.remoteStationStatus?.supportedCommands.contains(command.name) == true else {
            throw XCatError.server("Remote Agent does not advertise \(command.name).")
        }
        let requestID = "xcat-\(UUID().uuidString.lowercased())"
        let request = try RemoteAgentRequestBuilder.commandRequest(
            endpoint: endpoint,
            token: token,
            requestID: requestID,
            command: command
        )
        var lastError: (any Error)?
        for attempt in 0..<2 {
            guard shouldRun, commandGeneration == generation, !Task.isCancelled else { throw XCatError.notConnected }
            do {
                let (data, response) = try await session.data(for: request)
                guard shouldRun, commandGeneration == generation, !Task.isCancelled else { throw XCatError.notConnected }
                let receivedAt = Date()
                try Self.validate(response: response, data: data)
                let decoded: RemoteAgentDecodedState?
                if let spot = expectedSpot {
                    decoded = try RemoteAgentStateDecoder.spotCommandResponse(data, expected: spot, receivedAt: receivedAt)
                } else {
                    decoded = try RemoteAgentStateDecoder.commandResponse(data, receivedAt: receivedAt)
                }
                if let decoded { apply(decoded) }
                return
            } catch {
                lastError = error
                if attempt == 0 {
                    try? await Task.sleep(for: .milliseconds(200))
                    continue
                }
            }
        }
        throw lastError ?? XCatError.server("Remote Agent command failed.")
    }

    private func apply(_ decoded: RemoteAgentDecodedState) {
        var snapshot = decoded.snapshot
        authoritativeValue = decoded.snapshot
        // Immutable decoded evidence, before optimistic pending-write overlays.
        onObservedSnapshot(decoded.snapshot)
        pendingWrites.reconcile(&snapshot)
        value = snapshot
        wordsPerMinute = decoded.cwSpeed
        onSnapshot(value)
    }

    private func publishPendingWrites() {
        var snapshot = authoritativeValue
        pendingWrites.reconcile(&snapshot)
        value = snapshot
        onSnapshot(value)
    }

    private func scheduleFrequencyVerification(_ frequencyHz: Int64, vfo: String) {
        let letter = vfo.uppercased()
        let verificationID = UUID()
        let verificationGeneration = generation
        frequencyVerificationTasks[letter]?.cancel()
        frequencyVerificationIDs[letter] = verificationID
        frequencyVerificationTasks[letter] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            await self?.verifyFrequency(frequencyHz, vfo: letter, verificationID: verificationID,
                                        connectionGeneration: verificationGeneration)
        }
    }

    private func verifyFrequency(_ frequencyHz: Int64, vfo: String, verificationID: UUID,
                                 connectionGeneration: Int) async {
        guard shouldRun, generation == connectionGeneration,
              frequencyVerificationIDs[vfo] == verificationID else { return }
        if authoritativeValue.vfo(vfo)?.frequencyHz == frequencyHz {
            frequencyVerificationTasks[vfo] = nil
            frequencyVerificationIDs[vfo] = nil
            return
        }
        do {
            try await execute(.frequency(frequencyHz, vfo: vfo))
            guard !Task.isCancelled, generation == connectionGeneration,
                  frequencyVerificationIDs[vfo] == verificationID else { return }
            pendingWrites.expectFrequency(frequencyHz, vfo: vfo)
            publishPendingWrites()
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, generation == connectionGeneration,
                  frequencyVerificationIDs[vfo] == verificationID else { return }
            if authoritativeValue.vfo(vfo)?.frequencyHz != frequencyHz {
                pendingWrites.cancelFrequency(vfo: vfo)
                publishPendingWrites()
                transition(.ready, "FLEX did not confirm \(vfo) at \(frequencyHz) Hz")
            }
        } catch {
            guard !Task.isCancelled, shouldRun, generation == connectionGeneration,
                  frequencyVerificationIDs[vfo] == verificationID else { return }
            pendingWrites.cancelFrequency(vfo: vfo)
            publishPendingWrites()
            transition(.ready, "Frequency retry failed: \(error.localizedDescription)")
        }
        guard generation == connectionGeneration,
              frequencyVerificationIDs[vfo] == verificationID else { return }
        frequencyVerificationTasks[vfo] = nil
        frequencyVerificationIDs[vfo] = nil
    }

    private func connectionFailed(_ message: String, generation currentGeneration: Int) {
        guard currentGeneration == generation else { return }
        generation += 1
        retirePendingWrites()
        streamTask?.cancel()
        streamTask = nil
        watchdogTask?.cancel()
        watchdogTask = nil
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        markDisconnected(message)
        guard shouldRun else {
            transition(.stopped, "Stopped")
            return
        }
        scheduleReconnect(message)
    }

    private func retirePendingWrites() {
        frequencyVerificationTasks.values.forEach { $0.cancel() }
        frequencyVerificationTasks.removeAll()
        frequencyVerificationIDs.removeAll()
        pendingWrites = PendingRadioWrites()
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

    private func markDisconnected(_ reason: String) {
        value.isConnected = false
        value.isTransmitting = false
        if var status = value.remoteStationStatus {
            status.radioKnown = false
            status.radioStale = true
            status.inhibitors = [reason] + status.inhibitors.filter { $0 != reason }
            value.remoteStationStatus = status
        }
        onSnapshot(value)
    }

    private func receiveVFO() -> String {
        value.vfo("B")?.isReceive == true ? "B" : "A"
    }

    private func normalizedVFO(_ value: String?) -> String? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return normalized == "A" || normalized == "B" ? normalized : nil
    }

    private func transition(_ state: RadioConnectionState, _ description: String) {
        onState(state, description)
    }

    private static func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw XCatError.server("Remote Agent returned an invalid response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let error = object?["error"] as? [String: Any]
            let detail = object?["detail"] as? String
            let message = error?["message"] as? String ?? detail
                ?? "Remote Agent request failed (HTTP \(http.statusCode))."
            throw XCatError.server(message)
        }
    }
}
