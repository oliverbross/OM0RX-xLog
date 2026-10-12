@preconcurrency import Network
import Foundation

public final class TCPCommandServer: @unchecked Sendable {
    public enum SessionTransmitIntent: Sendable, Equatable {
        case none
        case acquire
        case release
    }

    private final class StartupGate: @unchecked Sendable {
        private let lock = NSLock()
        private let semaphore = DispatchSemaphore(value: 0)
        private var resolved = false
        private var failure: String?

        func resolve(failure: String? = nil) {
            let shouldSignal = lock.withLock {
                guard !resolved else { return false }
                resolved = true
                self.failure = failure
                return true
            }
            if shouldSignal { semaphore.signal() }
        }

        func wait(timeout: DispatchTime) -> String? {
            guard semaphore.wait(timeout: timeout) == .success else {
                return "Timed out waiting for the listener to become ready."
            }
            return lock.withLock { failure }
        }
    }

    public enum Framing: Sendable {
        case semicolon
        case newline

        fileprivate var delimiter: UInt8 {
            switch self {
            case .semicolon: Character(";").asciiValue!
            case .newline: Character("\n").asciiValue!
            }
        }
    }

    public typealias Handler = @Sendable (String) async -> String?
    public typealias TransmitIntentResolver = @Sendable (String, String?) -> SessionTransmitIntent
    public typealias DisconnectHandler = @Sendable (_ ownedTransmit: Bool) async -> Void
    public typealias EventHandler = @Sendable (String) -> Void

    // Scoped to the connection handling this command. The radio adapter calls
    // this only after authorization and before attempting a transmit write, so
    // denied/read-only commands cannot acquire another client's release duty.
    @TaskLocal fileprivate static var transmitAttemptObserver: (@Sendable () async -> Void)?

    public static func recordAuthorizedTransmitAttempt() async {
        await transmitAttemptObserver?()
    }

    private let queue: DispatchQueue
    private let framing: Framing
    private let handler: Handler
    private let transmitIntentResolver: TransmitIntentResolver
    private let onDisconnect: DisconnectHandler
    private let onEvent: EventHandler
    private let lock = NSLock()
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private var sessions: [ObjectIdentifier: ConnectionSession] = [:]

    public var boundPort: UInt16? { lock.withLock { listener?.port?.rawValue } }

    public init(
        label: String,
        framing: Framing,
        handler: @escaping Handler,
        transmitIntentResolver: @escaping TransmitIntentResolver = { _, _ in .none },
        onDisconnect: @escaping DisconnectHandler = { _ in },
        onEvent: @escaping EventHandler = { _ in }
    ) {
        queue = DispatchQueue(label: label)
        self.framing = framing
        self.handler = handler
        self.transmitIntentResolver = transmitIntentResolver
        self.onDisconnect = onDisconnect
        self.onEvent = onEvent
    }

    public func start(port: UInt16) throws {
        guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
            throw XCatError.server("Invalid TCP port \(port).")
        }
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: endpointPort)

        let newListener = try NWListener(using: parameters)
        let startup = StartupGate()
        newListener.stateUpdateHandler = { [weak newListener, onEvent] state in
            switch state {
            case .ready:
                startup.resolve()
                onEvent("Listening on 127.0.0.1:\(newListener?.port?.rawValue ?? port)")
            case let .failed(error):
                startup.resolve(failure: error.localizedDescription)
                onEvent("Listener failed on port \(port): \(error)")
            case .cancelled:
                onEvent("Listener stopped on port \(port)")
            default:
                break
            }
        }
        newListener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }

        lock.withLock {
            listener?.cancel()
            listener = newListener
        }
        newListener.start(queue: queue)
        if let failure = startup.wait(timeout: .now() + 3) {
            newListener.cancel()
            lock.withLock {
                if listener === newListener { listener = nil }
            }
            throw XCatError.server("Could not listen on 127.0.0.1:\(port): \(failure)")
        }
    }

    public func stop() {
        let activeConnections = lock.withLock {
            listener?.cancel()
            listener = nil
            let values = Array(connections.values)
            connections.removeAll()
            return values
        }
        activeConnections.forEach { $0.cancel() }
    }

    public func stopAndDrain() async {
        stop()
        let activeSessions = lock.withLock { Array(sessions.values) }
        await withTaskGroup(of: Void.self) { group in
            for session in activeSessions {
                group.addTask { await session.disconnectAndWait() }
            }
        }
    }

    private func accept(_ connection: NWConnection) {
        let session = ConnectionSession(
            framing: framing,
            handler: handler,
            transmitIntentResolver: transmitIntentResolver,
            onDisconnect: onDisconnect
        )
        let identifier = ObjectIdentifier(connection)
        let accepted = lock.withLock {
            guard listener != nil else { return false }
            connections[identifier] = connection
            sessions[identifier] = session
            return true
        }
        guard accepted else { connection.cancel(); return }
        connection.stateUpdateHandler = { [weak self, onEvent] state in
            switch state {
            case .ready:
                onEvent("Client connected")
            case let .failed(error):
                onEvent("Client failed: \(error)")
                self?.removeConnection(identifier)
                Task { [weak self] in
                    await session.disconnectAndWait()
                    self?.removeSession(identifier)
                }
            case .cancelled:
                onEvent("Client disconnected")
                self?.removeConnection(identifier)
                Task { [weak self] in
                    await session.disconnectAndWait()
                    self?.removeSession(identifier)
                }
            default:
                break
            }
        }
        connection.start(queue: queue)
        receive(on: connection, session: session)
    }

    private func removeConnection(_ identifier: ObjectIdentifier) {
        lock.withLock { _ = connections.removeValue(forKey: identifier) }
    }

    private func removeSession(_ identifier: ObjectIdentifier) {
        lock.withLock { _ = sessions.removeValue(forKey: identifier) }
    }

    private func receive(on connection: NWConnection, session: ConnectionSession) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8_192) { [weak self] data, _, complete, error in
            guard let self else {
                connection.cancel()
                return
            }
            if let data, !data.isEmpty {
                Task {
                    let responses = await session.ingest(data)
                    self.send(responses, index: 0, on: connection) {
                        if complete || error != nil {
                            connection.cancel()
                        } else {
                            self.receive(on: connection, session: session)
                        }
                    }
                }
            } else if complete || error != nil {
                connection.cancel()
            } else {
                self.receive(on: connection, session: session)
            }
        }
    }

    private func send(
        _ responses: [Data],
        index: Int,
        on connection: NWConnection,
        completion: @escaping @Sendable () -> Void
    ) {
        guard index < responses.count else {
            completion()
            return
        }
        connection.send(content: responses[index], completion: .contentProcessed { [weak self] error in
            if error != nil {
                connection.cancel()
                return
            }
            self?.send(responses, index: index + 1, on: connection, completion: completion)
        })
    }

    public static func catTransmitIntent(command: String, response: String?) -> SessionTransmitIntent {
        let normalized = command.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard response == nil else { return .none }
        if ["TX", "TX0", "TX1", "TX2"].contains(normalized) { return .acquire }
        if normalized == "RX" { return .release }
        if normalized.hasPrefix("KY") {
            let payload = String(command.dropFirst(2))
            return payload.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .release : .acquire
        }
        return .none
    }

    public static func rigCtlTransmitIntent(command: String, response: String?) -> SessionTransmitIntent {
        guard response?.trimmingCharacters(in: .whitespacesAndNewlines) == "RPRT 0" else { return .none }
        let normalized = command.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if normalized == "T 1" { return .acquire }
        if normalized == "T 0" { return .release }
        return .none
    }
}

actor ConnectionSession {
    private let delimiter: UInt8
    private let handler: TCPCommandServer.Handler
    private let transmitIntentResolver: TCPCommandServer.TransmitIntentResolver
    private let onDisconnect: TCPCommandServer.DisconnectHandler
    private var buffer = Data()
    private var didDisconnect = false
    private var ownsTransmit = false
    private var inFlightCommands = 0
    private var didFinishDisconnect = false
    private var didCompleteDisconnect = false
    private var disconnectWaiters: [CheckedContinuation<Void, Never>] = []

    init(
        framing: TCPCommandServer.Framing,
        handler: @escaping TCPCommandServer.Handler,
        transmitIntentResolver: @escaping TCPCommandServer.TransmitIntentResolver,
        onDisconnect: @escaping TCPCommandServer.DisconnectHandler
    ) {
        delimiter = framing.delimiter
        self.handler = handler
        self.transmitIntentResolver = transmitIntentResolver
        self.onDisconnect = onDisconnect
    }

    func ingest(_ data: Data) async -> [Data] {
        guard !didDisconnect else { return [] }
        buffer.append(data)
        if buffer.count > 65_536 {
            buffer.removeAll(keepingCapacity: true)
            return []
        }

        var responses: [Data] = []
        while !didDisconnect, let delimiterIndex = buffer.firstIndex(of: delimiter) {
            let commandData = buffer[..<delimiterIndex]
            buffer.removeSubrange(...delimiterIndex)
            guard let command = String(data: commandData, encoding: .utf8) else { continue }
            inFlightCommands += 1
            let response = await TCPCommandServer.$transmitAttemptObserver.withValue({
                await self.recordTransmitAttempt()
            }) {
                await handler(command)
            }
            inFlightCommands -= 1
            switch transmitIntentResolver(command, response) {
            case .acquire: ownsTransmit = true
            case .release: ownsTransmit = false
            case .none: break
            }
            if didDisconnect {
                await finishDisconnectIfReady()
                return []
            }
            if let response, let responseData = response.data(using: .utf8) {
                responses.append(responseData)
            }
        }
        return responses
    }

    func disconnect() async {
        guard !didDisconnect else { return }
        didDisconnect = true
        buffer.removeAll()
        await finishDisconnectIfReady()
    }

    func disconnectAndWait() async {
        await disconnect()
        guard !didCompleteDisconnect else { return }
        await withCheckedContinuation { disconnectWaiters.append($0) }
    }

    private func recordTransmitAttempt() {
        // Keep this duty on an ambiguous reply: a failed acknowledgment does
        // not prove the radio failed to start transmitting.
        ownsTransmit = true
    }

    private func finishDisconnectIfReady() async {
        guard didDisconnect, inFlightCommands == 0, !didFinishDisconnect else { return }
        didFinishDisconnect = true
        // A late transmit write must finish before its release is attempted.
        await onDisconnect(ownsTransmit)
        didCompleteDisconnect = true
        let waiters = disconnectWaiters
        disconnectWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }
}

private extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
