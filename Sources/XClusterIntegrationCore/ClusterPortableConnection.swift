import Foundation
import CClusterSocket

/// Windows/POSIX transport behind the same ordered session contract as macOS.
/// All socket operations and closure belong to one lane. Stop only cancels the
/// lane; it never closes a descriptor that a concurrent syscall may still use.
final class ClusterPortableConnection: ClusterConnectionTransport, @unchecked Sendable {
    private let server: ClusterServerConfiguration
    private let password: String
    private var reconnect: Bool
    private var requestSkimmer: Bool
    private let onState: @Sendable (ClusterConnectionPhase, String?) -> Void
    private let onLine: @Sendable (String) -> Void
    private let resolver: ClusterAddressResolver
    private let connectionTimeoutMilliseconds: Int
    private let cancellation = xlog_socket_cancellation_create()
    private let queue: DispatchQueue
    private let lock = NSLock()
    private var started = false
    private var running = false
    private var connected = false
    private var loggedIn = false
    private var outgoing: [Data] = []
    private var overflow = false

    init(server: ClusterServerConfiguration, password: String, reconnect: Bool, requestSkimmer: Bool,
         onState: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
         onLine: @escaping @Sendable (String) -> Void,
         resolver: ClusterAddressResolver = .shared, connectionTimeoutMilliseconds: Int = 10_000) {
        self.server = server
        self.password = password
        self.reconnect = reconnect
        self.requestSkimmer = requestSkimmer
        self.onState = onState
        self.onLine = onLine
        self.resolver = resolver
        self.connectionTimeoutMilliseconds = min(10_000, max(1, connectionTimeoutMilliseconds))
        queue = DispatchQueue(label: "com.oliverbross.xlog.cluster.socket.\(server.id.uuidString)")
    }

    deinit { xlog_socket_cancellation_destroy(cancellation) }

    func start() {
        guard lock.withLock({
            guard !started else { return false }
            started = true
            running = true
            return true
        }) else { return }
        guard cancellation != nil else { onState(.failed, "Cluster socket allocation failed."); return }
        queue.async { self.run() }
    }

    func stop() {
        xlog_socket_cancel(cancellation)
        lock.withLock { connected = false; outgoing.removeAll() }
    }

    func updateOptions(reconnect: Bool, requestSkimmer: Bool) {
        let resume = lock.withLock { () -> Bool in
            guard !cancelled else { return false }
            if self.requestSkimmer != requestSkimmer, loggedIn {
                if outgoing.count >= 64 { overflow = true }
                else { outgoing.append(Data(((requestSkimmer ? "set/skimmer" : "unset/skimmer") + "\r\n").utf8)) }
            }
            self.reconnect = reconnect
            self.requestSkimmer = requestSkimmer
            guard reconnect, started, !running else { return false }
            running = true
            return true
        }
        if resume { queue.async { self.run() } }
    }

    func send(_ command: String) {
        // The session also validates commands. Keep this lower boundary bounded
        // for injected/direct callers and never replay pending text on reconnect.
        guard !command.isEmpty, command.utf8.count <= 160,
              command.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { return }
        lock.withLock {
            guard connected, !cancelled else { return }
            if outgoing.count >= 64 { overflow = true; return }
            outgoing.append(Data((command + "\r\n").utf8))
        }
    }

    private var cancelled: Bool { xlog_socket_cancelled(cancellation) != 0 }

    private func pause(_ seconds: Double) -> Bool {
        let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(seconds * 1_000_000_000)
        while !cancelled, DispatchTime.now().uptimeNanoseconds < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
        return !cancelled
    }

    private func run() {
        guard (1...65_535).contains(server.port), !server.host.isEmpty,
              server.host.utf8.count <= 253,
              !server.host.unicodeScalars.contains(where: { $0.value < 0x21 || $0.value == 0x7f }) else {
            onState(.failed, "Invalid cluster endpoint."); return
        }
        var retry = 0
        defer {
            // An enable can race the lane's exit after it observed reconnect=false.
            let resume = lock.withLock { () -> Bool in
                running = false
                guard reconnect, !cancelled else { return false }
                running = true
                return true
            }
            if resume { queue.async { self.run() } }
        }
        while !cancelled {
            onState(.connecting, nil)
            let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(connectionTimeoutMilliseconds) * 1_000_000
            let addresses = resolver.resolve(host: server.host, port: UInt16(server.port), deadline: deadline, cancelled: { self.cancelled })
            let now = DispatchTime.now().uptimeNanoseconds
            let remaining = now < deadline ? Int32((deadline - now) / 1_000_000) : 0
            let socket = addresses.flatMap { resolved in
                withExtendedLifetime(resolved) { xlog_socket_connect_addresses(resolved.pointer, remaining, cancellation) }
            }
            guard !cancelled else { if let socket { xlog_socket_close(socket) }; break }
            if let socket {
                retry = 0
                lock.withLock { connected = true; overflow = false }
                onState(.connected, nil)
                let reason = receiveSession(socket)
                lock.withLock { connected = false; loggedIn = false; outgoing.removeAll(); overflow = false }
                xlog_socket_close(socket)
                if cancelled { break }
                onState(.failed, reason)
            } else {
                onState(.failed, "Cluster connection failed or timed out.")
            }
            guard lock.withLock({ reconnect }) else { break }
            let delays: [Double] = [2, 5, 10, 20, 30, 60]
            guard pause(delays[min(retry, delays.count - 1)]) else { break }
            guard lock.withLock({ reconnect }) else { break }
            retry += 1
        }
    }

    private func write(_ data: Data, to socket: OpaquePointer) -> Bool {
        let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
        var offset = 0
        while offset < data.count, !cancelled, DispatchTime.now().uptimeNanoseconds < deadline {
            let count = data.withUnsafeBytes { bytes in
                xlog_socket_write(socket, bytes.baseAddress!.advanced(by: offset), Int32(data.count - offset))
            }
            if count == -2 { if !pause(0.02) { return false }; continue }
            guard count > 0 else { return false }
            offset += Int(count)
        }
        return offset == data.count && !cancelled
    }

    private func receiveSession(_ socket: OpaquePointer) -> String {
        guard pause(0.45) else { return "Disconnected." }
        var login = server.callsign.uppercased() + "\r\n"
        if !password.isEmpty { login += password + "\r\n" }
        let skimmer = lock.withLock { requestSkimmer }
        login += (skimmer ? "set/skimmer" : "unset/skimmer") + "\r\n"
        guard write(Data(login.utf8), to: socket) else { return "Cluster login could not be sent." }
        lock.withLock {
            loggedIn = true
            if requestSkimmer != skimmer {
                outgoing.append(Data(((requestSkimmer ? "set/skimmer" : "unset/skimmer") + "\r\n").utf8))
            }
        }
        var framer = ClusterTelnetLineFramer()
        var buffer = [UInt8](repeating: 0, count: 32_768)
        while !cancelled {
            let pending = lock.withLock { () -> (Data?, Bool) in
                (outgoing.isEmpty ? nil : outgoing.removeFirst(), overflow)
            }
            if pending.1 { return "Cluster command queue is full; connection closed without replay." }
            if let message = pending.0, !write(message, to: socket) {
                return "Cluster command delivery is unconfirmed; pending commands were not replayed."
            }
            let count = buffer.withUnsafeMutableBytes { xlog_socket_read(socket, $0.baseAddress, Int32($0.count), 100) }
            if count == -2 { continue }
            if count < 0 { return "Cluster receive failed." }
            if count == 0 { return "Cluster closed the connection." }
            for line in framer.consume(Data(buffer.prefix(Int(count)))) where !cancelled {
                onLine(password.isEmpty ? line : line.replacingOccurrences(of: password, with: "[redacted]"))
            }
        }
        return "Disconnected."
    }
}
