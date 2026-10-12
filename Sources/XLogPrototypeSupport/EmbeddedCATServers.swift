#if os(macOS)
import Darwin
import Foundation
import XCatIntegrationCore

/// Optional local compatibility listeners for TS-480 CAT and RigCtlD clients.
/// The radio remains owned by the calling station session; this type never
/// creates a second radio transport or starts listening during initialization.
final class EmbeddedCATServers: @unchecked Sendable {
    enum Mutation: Sendable {
        case primaryFrequency(Int64)
        case frequency(Int64)
        case frequencyAndMode(Int64, String)
        case tuneSimplex(Int64, String)
        case mode(String)
        case secondaryFrequency(Int64)
        case splitTransmit(Bool)
        case receiveVFO(Int)
        case cwSpeed(Int)
        case sendCW(String)
        case clearCW
        case transmit(Bool)
        case transmitMode(CATTransmitMode)
        case rit(Bool, Int, String?)
        case xit(Bool, Int, String?)
        case rfPower(Int)
        case stationAction(RemoteStationAction)
        case namedStationAction(String)
        case addSpot(FlexSpot)
    }

    typealias MutationAuthorization = @Sendable (Mutation) async -> Bool
    typealias MutationCompletion = @Sendable (Mutation) async -> Void
    typealias SnapshotProvider = @Sendable () async -> RadioSnapshot

    struct Configuration: Equatable, Sendable {
        var catPort: UInt16?
        var rigCtlPort: UInt16?
        var allowTransmit: Bool

        init(catPort: UInt16? = nil, rigCtlPort: UInt16? = nil, allowTransmit: Bool = false) {
            self.catPort = catPort
            self.rigCtlPort = rigCtlPort
            self.allowTransmit = allowTransmit
        }
    }

    enum StartError: LocalizedError, Equatable {
        case invalidPort
        case duplicatePort(UInt16)
        case portUnavailable(UInt16)
        case listenerFailed(UInt16, String)

        var errorDescription: String? {
            switch self {
            case .invalidPort: "CAT listener ports must be between 1 and 65535."
            case let .duplicatePort(port): "CAT and RigCtlD cannot share loopback port \(port)."
            case let .portUnavailable(port): "Loopback port \(port) is already in use."
            case let .listenerFailed(port, detail): "Could not start loopback listener on port \(port): \(detail)"
            }
        }
    }

    typealias EventHandler = @Sendable (_ service: String, _ event: String) -> Void

    private let radio: any RadioControlling
    private let configuration: Configuration
    private let allowEphemeralPorts: Bool
    private let onEvent: EventHandler
    private let guardedRadio: GuardedRadio
    private let stationStateProvider: RigCtlCommandProcessor.StationStateProvider?
    private let stationActionHandler: RigCtlCommandProcessor.StationActionHandler?
    private let lock = NSLock()
    private var catServer: TCPCommandServer?
    private var rigCtlServer: TCPCommandServer?

    var boundCATPort: UInt16? { lock.withLock { catServer?.boundPort } }
    var boundRigCtlPort: UInt16? { lock.withLock { rigCtlServer?.boundPort } }

    init(
        radio: any RadioControlling,
        configuration: Configuration,
        observedSnapshot: SnapshotProvider? = nil,
        authorizeMutation: @escaping MutationAuthorization,
        didCompleteMutation: @escaping MutationCompletion = { _ in },
        stationStateProvider: RigCtlCommandProcessor.StationStateProvider? = nil,
        stationActionHandler: RigCtlCommandProcessor.StationActionHandler? = nil,
        onEvent: @escaping EventHandler = { _, _ in },
        allowEphemeralPorts: Bool = false
    ) {
        self.radio = radio
        self.configuration = configuration
        // Internal fixture opt-in only; user configuration still rejects zero.
        // Let the OS atomically allocate and retain test ports, with no
        // bind/close/rebind window where another process can take the port.
        self.allowEphemeralPorts = allowEphemeralPorts
        guardedRadio = GuardedRadio(
            radio: radio,
            observedSnapshot: observedSnapshot ?? { await radio.snapshot() },
            authorize: authorizeMutation,
            completed: didCompleteMutation
        )
        self.stationStateProvider = stationStateProvider
        self.stationActionHandler = stationActionHandler
        self.onEvent = onEvent
    }

    deinit { stop() }

    /// Starts only explicitly configured listeners, or does nothing if both
    /// ports are nil. A failed second listener rolls back the first one.
    func start() throws {
        lock.lock()
        defer { lock.unlock() }
        guard catServer == nil, rigCtlServer == nil else { return }
        if !allowEphemeralPorts && (configuration.catPort == 0 || configuration.rigCtlPort == 0) {
            throw StartError.invalidPort
        }
        if let catPort = configuration.catPort, catPort != 0, catPort == configuration.rigCtlPort {
            throw StartError.duplicatePort(catPort)
        }
        // The copied listener enables local endpoint reuse. A non-reuse bind
        // catches a pre-existing service before we hand the port to Network.
        for port in [configuration.catPort, configuration.rigCtlPort].compactMap({ $0 }) where port != 0 {
            guard Self.loopbackPortIsFree(port) else { throw StartError.portUnavailable(port) }
        }

        let catProcessor = CATCommandProcessor(radio: guardedRadio, allowTransmit: configuration.allowTransmit)
        let authorizedAction: RigCtlCommandProcessor.StationActionHandler?
        if let stationActionHandler {
            authorizedAction = { [guardedRadio] action in
                await guardedRadio.performNamedStationAction(action, using: stationActionHandler)
            }
        } else {
            authorizedAction = nil
        }
        let rigCtlProcessor = RigCtlCommandProcessor(
            radio: guardedRadio,
            allowTransmit: configuration.allowTransmit,
            stationStateProvider: stationStateProvider,
            stationActionHandler: authorizedAction
        )
        let disconnect: TCPCommandServer.DisconnectHandler = { [guardedRadio] ownedTransmit in
            guard ownedTransmit else { return }
            try? await guardedRadio.clearCW()
            // TX2 maps to a station tune action for Remote Agent, so PTT-off
            // alone does not necessarily cancel it. The owner may deny this
            // when no tune obligation exists; direct FLEX has no such action.
            try? await guardedRadio.performStationAction(.cancel)
            try? await guardedRadio.setTransmit(false)
        }

        if let port = configuration.catPort {
            let server = TCPCommandServer(
                label: "com.om0rx.xlog.embedded-cat",
                framing: .semicolon,
                handler: { command in await catProcessor.handle(command) },
                transmitIntentResolver: { command, response in
                    TCPCommandServer.catTransmitIntent(command: command, response: response)
                },
                onDisconnect: disconnect,
                onEvent: { [onEvent] event in onEvent("CAT", event) }
            )
            do { try server.start(port: port) }
            catch { throw StartError.listenerFailed(port, error.localizedDescription) }
            catServer = server
        }

        if let port = configuration.rigCtlPort {
            let server = TCPCommandServer(
                label: "com.om0rx.xlog.embedded-rigctl",
                framing: .newline,
                handler: { command in await rigCtlProcessor.handle(command) },
                transmitIntentResolver: { command, response in
                    TCPCommandServer.rigCtlTransmitIntent(command: command, response: response)
                },
                onDisconnect: disconnect,
                onEvent: { [onEvent] event in onEvent("RigCtlD", event) }
            )
            do { try server.start(port: port) }
            catch {
                catServer?.stop()
                catServer = nil
                throw StartError.listenerFailed(port, error.localizedDescription)
            }
            rigCtlServer = server
        }
    }

    /// Cancels the listeners and their clients. The copied server invokes the
    /// owned-TX disconnect callback asynchronously for each cancelled client.
    func stop() {
        let servers = takeServers()
        servers.forEach { $0.stop() }
    }

    func stopAndDrain() async {
        let servers = takeServers()
        servers.forEach { $0.stop() }
        await guardedRadio.retire()
        await withTaskGroup(of: Void.self) { group in
            for server in servers { group.addTask { await server.stopAndDrain() } }
        }
    }

    private func takeServers() -> [TCPCommandServer] {
        lock.lock()
        defer { lock.unlock() }
        let servers = [catServer, rigCtlServer].compactMap { $0 }
        catServer = nil
        rigCtlServer = nil
        return servers
    }

    private static func loopbackPortIsFree(_ port: UInt16) -> Bool {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { Darwin.close(descriptor) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }
}

/// All processor writes pass through this actor, so an owning session can
/// enforce current connection/commissioning policy before the transport call.
/// Completion is emitted only after a successful transport return; lack of a
/// completion for a TX attempt remains a release obligation for the owner.
private actor GuardedRadio: RadioControlling {
    typealias Mutation = EmbeddedCATServers.Mutation

    private let radio: any RadioControlling
    private let observedSnapshot: EmbeddedCATServers.SnapshotProvider
    private let authorize: EmbeddedCATServers.MutationAuthorization
    private let completed: EmbeddedCATServers.MutationCompletion
    private var retired = false

    func retire() { retired = true }

    private func isRelease(_ mutation: Mutation) -> Bool {
        switch mutation {
        case .transmit(false), .clearCW, .stationAction(.cancel), .stationAction(.standby): true
        default: false
        }
    }

    init(
        radio: any RadioControlling,
        observedSnapshot: @escaping EmbeddedCATServers.SnapshotProvider,
        authorize: @escaping EmbeddedCATServers.MutationAuthorization,
        completed: @escaping EmbeddedCATServers.MutationCompletion
    ) {
        self.radio = radio
        self.observedSnapshot = observedSnapshot
        self.authorize = authorize
        self.completed = completed
    }

    private func execute(_ mutation: Mutation, body: () async throws -> Void) async throws {
        guard !retired || isRelease(mutation) else { throw XCatError.unsupported }
        guard await authorize(mutation) else { throw XCatError.unsupported }
        guard !retired || isRelease(mutation) else { throw XCatError.unsupported }
        switch mutation {
        case .transmit(true), .transmitMode, .sendCW, .stationAction(.tune):
            await TCPCommandServer.recordAuthorizedTransmitAttempt()
        default: break
        }
        guard !retired || isRelease(mutation) else { throw XCatError.unsupported }
        try await body()
        await completed(mutation)
    }

    func snapshot() async -> RadioSnapshot { await observedSnapshot() }
    func primaryFrequency() async -> Int64? {
        let value = await observedSnapshot()
        return value.isConnected ? value.vfo("A")?.frequencyHz ?? value.frequencyHz : nil
    }
    func secondaryFrequency() async -> Int64? {
        let value = await observedSnapshot()
        return value.isConnected ? value.vfo("B")?.frequencyHz : nil
    }
    func cwSpeed() async -> Int { await radio.cwSpeed() }

    func setPrimaryFrequency(_ value: Int64) async throws {
        try await execute(.primaryFrequency(value)) { try await radio.setPrimaryFrequency(value) }
    }
    func setFrequency(_ value: Int64) async throws {
        try await execute(.frequency(value)) { try await radio.setFrequency(value) }
    }
    func setFrequencyAndMode(_ value: Int64, mode: String) async throws {
        try await execute(.frequencyAndMode(value, mode)) { try await radio.setFrequencyAndMode(value, mode: mode) }
    }
    func tuneSimplex(_ value: Int64, mode: String) async throws {
        try await execute(.tuneSimplex(value, mode)) { try await radio.tuneSimplex(value, mode: mode) }
    }
    func setMode(_ value: String) async throws {
        try await execute(.mode(value)) { try await radio.setMode(value) }
    }
    func setSecondaryFrequency(_ value: Int64) async throws {
        try await execute(.secondaryFrequency(value)) { try await radio.setSecondaryFrequency(value) }
    }
    func setSplitTransmit(_ enabled: Bool) async throws {
        try await execute(.splitTransmit(enabled)) { try await radio.setSplitTransmit(enabled) }
    }
    func setReceiveVFO(_ value: Int) async throws {
        try await execute(.receiveVFO(value)) { try await radio.setReceiveVFO(value) }
    }
    func setCWSpeed(_ value: Int) async throws {
        try await execute(.cwSpeed(value)) { try await radio.setCWSpeed(value) }
    }
    func sendCW(_ value: String) async throws {
        try await execute(.sendCW(value)) { try await radio.sendCW(value) }
    }
    func clearCW() async throws {
        try await execute(.clearCW) { try await radio.clearCW() }
    }
    func setTransmit(_ enabled: Bool) async throws {
        try await execute(.transmit(enabled)) { try await radio.setTransmit(enabled) }
    }
    func setTransmit(_ mode: CATTransmitMode) async throws {
        try await execute(.transmitMode(mode)) { try await radio.setTransmit(mode) }
    }
    func setRIT(enabled: Bool, offsetHz: Int, vfo: String?) async throws {
        try await execute(.rit(enabled, offsetHz, vfo)) {
            try await radio.setRIT(enabled: enabled, offsetHz: offsetHz, vfo: vfo)
        }
    }
    func setXIT(enabled: Bool, offsetHz: Int, vfo: String?) async throws {
        try await execute(.xit(enabled, offsetHz, vfo)) {
            try await radio.setXIT(enabled: enabled, offsetHz: offsetHz, vfo: vfo)
        }
    }
    func setRFPower(_ value: Int) async throws {
        try await execute(.rfPower(value)) { try await radio.setRFPower(value) }
    }
    func performStationAction(_ action: RemoteStationAction) async throws {
        try await execute(.stationAction(action)) { try await radio.performStationAction(action) }
    }
    func addSpot(_ spot: FlexSpot) async throws {
        try await execute(.addSpot(spot)) { try await radio.addSpot(spot) }
    }

    func performNamedStationAction(
        _ action: String,
        using handler: RigCtlCommandProcessor.StationActionHandler
    ) async -> Bool {
        let mutation = Mutation.namedStationAction(action)
        guard !retired || action == "cancel" || action == "standby" else { return false }
        guard await authorize(mutation) else { return false }
        guard !retired || action == "cancel" || action == "standby" else { return false }
        if action == "tune" { await TCPCommandServer.recordAuthorizedTransmitAttempt() }
        guard await handler(action) else { return false }
        await completed(mutation)
        return true
    }
}
#endif
