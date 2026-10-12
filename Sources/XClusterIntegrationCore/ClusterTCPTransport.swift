import Foundation

#if canImport(Network)
import Network
#endif

/// Bounded Telnet line framing. Negotiation bytes may straddle TCP receives.
struct ClusterTelnetLineFramer {
    private enum State { case data, command, option, subnegotiation, subnegotiationIAC }
    private var state: State = .data
    private var line = Data()
    private var discardingLongLine = false

    mutating func consume(_ chunk: Data) -> [String] {
        var result: [String] = []
        for byte in chunk {
            switch state {
            case .data:
                if byte == 255 { state = .command; continue }
                if byte == 10 {
                    if !discardingLongLine,
                       let text = String(data: line, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !text.isEmpty { result.append(text) }
                    line.removeAll(keepingCapacity: true)
                    discardingLongLine = false
                } else if !discardingLongLine {
                    if line.count < ClusterLineParser.maximumLineBytes { line.append(byte) }
                    else { line.removeAll(keepingCapacity: true); discardingLongLine = true }
                }
            case .command:
                switch byte {
                case 255: state = .data // Escaped IAC is not useful in a UTF-8 spot line.
                case 250: state = .subnegotiation
                case 251...254: state = .option
                default: state = .data
                }
            case .option: state = .data
            case .subnegotiation: if byte == 255 { state = .subnegotiationIAC }
            case .subnegotiationIAC: state = byte == 240 ? .data : .subnegotiation
            }
        }
        return result
    }
}

public func makeClusterTCPTransport(
    server: ClusterServerConfiguration, password: String, reconnect: Bool, requestSkimmer: Bool,
    onState: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
    onLine: @escaping @Sendable (String) -> Void
) -> any ClusterConnectionTransport {
    #if canImport(Network)
    return ClusterNetworkConnection(server: server, password: password, reconnect: reconnect,
                                    requestSkimmer: requestSkimmer, onState: onState, onLine: onLine)
    #else
    return ClusterPortableConnection(server: server, password: password, reconnect: reconnect,
                                     requestSkimmer: requestSkimmer, onState: onState, onLine: onLine)
    #endif
}

#if canImport(Network)
/// Adapted from OM0RX-xCluster's ClusterHub/ClusterConnection (GPL-3.0-only).
/// Network.framework is the macOS transport; the service contract stays shared.
private final class ClusterNetworkConnection: ClusterConnectionTransport, @unchecked Sendable {
    private let server: ClusterServerConfiguration
    private let password: String
    private let reconnect: Bool
    private let requestSkimmer: Bool
    private let onState: @Sendable (ClusterConnectionPhase, String?) -> Void
    private let onLine: @Sendable (String) -> Void
    private let queue: DispatchQueue
    private var connection: NWConnection?
    private var framer = ClusterTelnetLineFramer()
    private var stopped = false
    private var retry = 0

    init(server: ClusterServerConfiguration, password: String, reconnect: Bool, requestSkimmer: Bool,
         onState: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
         onLine: @escaping @Sendable (String) -> Void) {
        self.server = server
        self.password = password
        self.reconnect = reconnect
        self.requestSkimmer = requestSkimmer
        self.onState = onState
        self.onLine = onLine
        queue = DispatchQueue(label: "com.oliverbross.xlog.cluster.\(server.id.uuidString)")
    }

    func start() { queue.async { self.open() } }

    func stop() {
        queue.async {
            self.stopped = true
            self.connection?.cancel()
            self.connection = nil
            self.framer = .init()
        }
    }

    func send(_ command: String) {
        queue.async { [weak self] in
            guard let self, !self.stopped, let connection = self.connection else { return }
            connection.send(content: Data((command + "\r\n").utf8), completion: .contentProcessed { [weak self] error in
                if let error { self?.queue.async { self?.closed(error.localizedDescription) } }
            })
        }
    }

    private func open() {
        guard !stopped, let port = NWEndpoint.Port(rawValue: UInt16(server.port)) else { return }
        onState(.connecting, nil)
        framer = .init()
        let newConnection = NWConnection(host: .init(server.host), port: port, using: .tcp)
        connection = newConnection
        newConnection.stateUpdateHandler = { [weak self, weak newConnection] state in
            guard let self, let newConnection else { return }
            self.queue.async {
                guard self.connection === newConnection, !self.stopped else { return }
                switch state {
                case .ready:
                    self.retry = 0
                    self.onState(.connected, nil)
                    self.sendLogin(on: newConnection)
                    self.receive(on: newConnection)
                case .failed(let error): self.closed(error.localizedDescription)
                case .cancelled: self.closed(nil)
                default: break
                }
            }
        }
        newConnection.start(queue: queue)
    }

    private func sendLogin(on connection: NWConnection) {
        queue.asyncAfter(deadline: .now() + 0.45) { [weak self, weak connection] in
            guard let self, let connection, self.connection === connection, !self.stopped else { return }
            var login = self.server.callsign.uppercased() + "\r\n"
            if !self.password.isEmpty { login += self.password + "\r\n" }
            login += (self.requestSkimmer ? "set/skimmer" : "unset/skimmer") + "\r\n"
            connection.send(content: Data(login.utf8), completion: .contentProcessed { [weak self] error in
                if let error { self?.queue.async { self?.closed(error.localizedDescription) } }
            })
        }
    }

    private func receive(on connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 32_768) { [weak self, weak connection] data, _, complete, error in
            guard let self, let connection else { return }
            self.queue.async {
                guard self.connection === connection, !self.stopped else { return }
                if let data {
                    for line in self.framer.consume(data) {
                        let safeLine = self.password.isEmpty ? line : line.replacingOccurrences(of: self.password, with: "[redacted]")
                        self.onLine(safeLine)
                    }
                }
                if let error { self.closed(error.localizedDescription); return }
                if complete { self.closed("Cluster closed the connection."); return }
                self.receive(on: connection)
            }
        }
    }

    private func closed(_ reason: String?) {
        connection?.cancel()
        connection = nil
        guard !stopped else { onState(.disconnected, nil); return }
        onState(reason == nil ? .disconnected : .failed, reason)
        guard reconnect else { return }
        let delays = [2, 5, 10, 20, 30, 60]
        let delay = delays[min(retry, delays.count - 1)]
        retry += 1
        queue.asyncAfter(deadline: .now() + .seconds(delay)) { [weak self] in self?.open() }
    }
}
#endif
