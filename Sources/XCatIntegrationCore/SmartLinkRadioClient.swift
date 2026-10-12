import Foundation

public actor SmartLinkRadioClient: RadioControlling {
    public typealias StateHandler = @Sendable (RadioConnectionState, String) -> Void
    public typealias SnapshotHandler = @Sendable (RadioSnapshot) -> Void
    public typealias SelectionHandler = @Sendable (SmartLinkRadio) -> Void

    private let email: String
    private var password: String
    private let preferredSerial: String
    private let stationName: String
    private let sliceLetter: String
    private let authenticator: SmartLinkAuthenticator
    private let onState: StateHandler
    private let onSnapshot: SnapshotHandler
    private let onRadioSelected: SelectionHandler

    private var broker: SmartLinkBroker?
    private var radio: FlexRadioClient?
    private var reconnectTask: Task<Void, Never>?
    private var stableConnectionTask: Task<Void, Never>?
    private var shouldRun = false
    private var generation = 0
    private var reconnectAttempt = 0
    private var value: RadioSnapshot

    public init(
        email: String,
        password: String,
        preferredSerial: String = "",
        stationName: String,
        sliceLetter: String = "A",
        authenticator: SmartLinkAuthenticator? = nil,
        onState: @escaping StateHandler = { _, _ in },
        onSnapshot: @escaping SnapshotHandler = { _ in },
        onRadioSelected: @escaping SelectionHandler = { _ in }
    ) {
        self.email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        self.password = password
        self.preferredSerial = preferredSerial.trimmingCharacters(in: .whitespacesAndNewlines)
        self.stationName = stationName
        self.sliceLetter = sliceLetter.uppercased()
        self.authenticator = authenticator ?? SmartLinkAuthenticator(
            keychain: SmartLinkKeychain(accountIdentifier: email)
        )
        self.onState = onState
        self.onSnapshot = onSnapshot
        self.onRadioSelected = onRadioSelected
        value = RadioSnapshot(isConnected: false, slice: sliceLetter.uppercased(), station: stationName)
    }

    public func start() {
        guard !shouldRun else { return }
        shouldRun = true
        reconnectAttempt = 0
        beginConnection()
    }

    public func stop() async {
        shouldRun = false
        generation += 1
        reconnectTask?.cancel()
        reconnectTask = nil
        stableConnectionTask?.cancel()
        stableConnectionTask = nil
        let activeRadio = radio
        let activeBroker = broker
        radio = nil
        broker = nil
        value.isConnected = false
        onSnapshot(value)
        await activeRadio?.stop()
        await activeBroker?.stop()
        transition(.stopped, "Stopped")
    }

    public func reconnectNow() async {
        guard shouldRun else {
            start()
            return
        }
        reconnectAttempt = 0
        generation += 1
        reconnectTask?.cancel()
        stableConnectionTask?.cancel()
        stableConnectionTask = nil
        let activeRadio = radio
        let activeBroker = broker
        radio = nil
        broker = nil
        value.isConnected = false
        onSnapshot(value)
        await activeRadio?.stop()
        await activeBroker?.stop()
        beginConnection()
    }

    public func snapshot() -> RadioSnapshot { value }

    public func setFrequency(_ frequencyHz: Int64) async throws {
        try await connectedRadio().setFrequency(frequencyHz)
    }

    public func setMode(_ mode: String) async throws {
        try await connectedRadio().setMode(mode)
    }

    public func setTransmit(_ enabled: Bool) async throws {
        try await connectedRadio().setTransmit(enabled)
    }

    public func secondaryFrequency() async -> Int64? {
        await radio?.secondaryFrequency()
    }

    public func setSecondaryFrequency(_ frequencyHz: Int64) async throws {
        try await connectedRadio().setSecondaryFrequency(frequencyHz)
    }

    public func setSplitTransmit(_ enabled: Bool) async throws {
        try await connectedRadio().setSplitTransmit(enabled)
    }

    public func setReceiveVFO(_ vfo: Int) async throws {
        try await connectedRadio().setReceiveVFO(vfo)
    }

    public func cwSpeed() async -> Int {
        await radio?.cwSpeed() ?? 25
    }

    public func setCWSpeed(_ wordsPerMinute: Int) async throws {
        try await connectedRadio().setCWSpeed(wordsPerMinute)
    }

    public func sendCW(_ text: String) async throws {
        try await connectedRadio().sendCW(text)
    }

    public func clearCW() async throws {
        guard let radio else { return }
        try await radio.clearCW()
    }

    public func addSpot(_ spot: FlexSpot) async throws {
        try await connectedRadio().addSpot(spot)
    }

    public func setTransmit(_ mode: CATTransmitMode) async throws {
        try await connectedRadio().setTransmit(mode)
    }

    private func connectedRadio() throws -> FlexRadioClient {
        guard let radio else { throw XCatError.notConnected }
        return radio
    }

    private func beginConnection() {
        guard shouldRun else { return }
        generation += 1
        let currentGeneration = generation
        reconnectTask = Task { [weak self] in
            await self?.establish(generation: currentGeneration)
        }
    }

    private func establish(generation currentGeneration: Int) async {
        guard shouldRun, currentGeneration == generation else { return }
        transition(.authenticating, "Authenticating with SmartLink")
        do {
            let token: SmartLinkTokenSet
            if !password.isEmpty {
                token = try await authenticator.authenticate(email: email, password: password)
            } else {
                token = try await authenticator.refresh()
            }
            password = ""
            guard shouldRun, currentGeneration == generation else { return }

            transition(.discovering, "Finding your remote FlexRadio")
            let newBroker = SmartLinkBroker(
                idToken: token.idToken,
                preferredSerial: preferredSerial,
                onDisconnect: { [weak self] message in
                    Task { await self?.brokerDisconnected(message, generation: currentGeneration) }
                }
            )
            broker = newBroker
            let session = try await newBroker.connect()
            guard shouldRun, currentGeneration == generation else {
                await newBroker.stop()
                return
            }
            onRadioSelected(session.radio)

            transition(.connecting, "Connecting to \(session.radio.nickname) (\(session.radio.model))")
            let newRadio = FlexRadioClient(
                host: session.radio.publicIP,
                port: session.radio.tlsPort,
                stationName: stationName,
                sliceLetter: sliceLetter,
                wanValidationHandle: session.validationHandle,
                certificateIdentity: session.radio.serial,
                onState: { [weak self] state, description in
                    Task { await self?.radioStateChanged(state, description: description, generation: currentGeneration) }
                },
                onSnapshot: { [weak self] snapshot in
                    Task { await self?.radioSnapshotChanged(snapshot, generation: currentGeneration) }
                }
            )
            radio = newRadio
            await newRadio.start()
        } catch {
            password = ""
            guard shouldRun, currentGeneration == generation else { return }
            if error is SmartLinkAuthError {
                transition(.failed, error.localizedDescription)
                return
            }
            await scheduleReconnect(error.localizedDescription)
        }
    }

    private func brokerDisconnected(_ message: String, generation currentGeneration: Int) async {
        guard shouldRun, currentGeneration == generation else { return }
        await scheduleReconnect(message)
    }

    private func radioStateChanged(
        _ state: RadioConnectionState,
        description: String,
        generation currentGeneration: Int
    ) async {
        guard shouldRun, currentGeneration == generation else { return }
        if state == .retrying || state == .failed {
            await scheduleReconnect(description)
            return
        }
        if state == .ready {
            stableConnectionTask?.cancel()
            stableConnectionTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { return }
                await self?.markStable(generation: currentGeneration)
            }
        }
        transition(state, description)
    }

    private func radioSnapshotChanged(_ snapshot: RadioSnapshot, generation currentGeneration: Int) {
        guard shouldRun, currentGeneration == generation else { return }
        value = snapshot
        onSnapshot(snapshot)
    }

    private func scheduleReconnect(_ message: String) async {
        generation += 1
        let nextGeneration = generation
        stableConnectionTask?.cancel()
        stableConnectionTask = nil
        let activeRadio = radio
        let activeBroker = broker
        radio = nil
        broker = nil
        value.isConnected = false
        onSnapshot(value)
        await activeRadio?.stop()
        await activeBroker?.stop()
        guard shouldRun else { return }

        reconnectAttempt += 1
        let base = min(pow(2.0, Double(max(0, reconnectAttempt - 1))), 30.0)
        let delay = base + Double.random(in: 0...(base * 0.25))
        transition(.retrying, "\(message). Retrying in \(String(format: "%.1f", delay)) s")
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.establish(generation: nextGeneration)
        }
    }

    private func transition(_ state: RadioConnectionState, _ description: String) {
        onState(state, description)
    }

    private func markStable(generation currentGeneration: Int) {
        guard shouldRun, currentGeneration == generation else { return }
        reconnectAttempt = 0
    }
}
