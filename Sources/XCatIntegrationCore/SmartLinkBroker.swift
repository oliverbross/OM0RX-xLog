@preconcurrency import Network
import Foundation

public struct SmartLinkRadio: Equatable, Sendable {
    public var serial: String
    public var nickname: String
    public var model: String
    public var status: String
    public var publicIP: String
    public var tlsPort: UInt16
    public var udpPort: UInt16?
}

public struct SmartLinkWANSession: Sendable {
    public var radio: SmartLinkRadio
    public var validationHandle: String
}

public enum SmartLinkBrokerError: LocalizedError, Sendable {
    case disconnected(String)
    case noRadio
    case malformedResponse

    public var errorDescription: String? {
        switch self {
        case let .disconnected(message): message
        case .noRadio: "No remotely reachable FlexRadio is available in this SmartLink account."
        case .malformedResponse: "SmartLink returned an invalid radio connection response."
        }
    }
}

public enum SmartLinkBrokerParser {
    public static func radios(from line: String) -> [SmartLinkRadio] {
        guard line.hasPrefix("radio list ") else { return [] }
        return line.dropFirst("radio list ".count).split(separator: "|").compactMap { record in
            let fields = keyValues(String(record))
            guard let serial = fields["serial"], !serial.isEmpty,
                  let publicIP = fields["public_ip"], !publicIP.isEmpty else { return nil }
            let manualTLS = Int(fields["public_tls_port"] ?? "") ?? -1
            let manualUDP = Int(fields["public_udp_port"] ?? "") ?? -1
            let upnpTLS = Int(fields["public_upnp_tls_port"] ?? "") ?? -1
            let upnpUDP = Int(fields["public_upnp_udp_port"] ?? "") ?? -1
            let upnp = fields["upnp_supported"] == "1"
            let tls = manualTLS > 0 ? manualTLS : (upnp ? upnpTLS : -1)
            let udp = manualUDP > 0 ? manualUDP : (upnp ? upnpUDP : -1)
            guard let tlsPort = UInt16(exactly: tls) else { return nil }
            return SmartLinkRadio(
                serial: serial,
                nickname: decode(fields["radio_name"] ?? fields["name"] ?? "FlexRadio"),
                model: decode(fields["model"] ?? "FlexRadio"),
                status: decode(fields["status"] ?? "Unknown"),
                publicIP: publicIP,
                tlsPort: tlsPort,
                udpPort: UInt16(exactly: udp)
            )
        }
    }

    public static func connectReady(from line: String) -> (handle: String, serial: String)? {
        guard line.hasPrefix("radio connect_ready") else { return nil }
        let fields = keyValues(line)
        guard let handle = fields["handle"], !handle.isEmpty,
              let serial = fields["serial"], !serial.isEmpty else { return nil }
        return (handle, serial)
    }

    private static func keyValues(_ value: String) -> [String: String] {
        var result: [String: String] = [:]
        for word in value.split(separator: " ") {
            let pair = word.split(separator: "=", maxSplits: 1).map(String.init)
            if pair.count == 2 { result[pair[0]] = pair[1] }
        }
        return result
    }

    private static func decode(_ value: String) -> String {
        value.replacingOccurrences(of: "\u{7F}", with: " ")
    }
}

public actor SmartLinkBroker {
    public typealias DisconnectHandler = @Sendable (String) -> Void

    private let idToken: String
    private let preferredSerial: String
    private let onDisconnect: DisconnectHandler
    private let queue = DispatchQueue(label: "com.oliverbross.OM0RXXCat.smartlink-broker")
    private var connection: NWConnection?
    private var buffer = Data()
    private var selectedRadio: SmartLinkRadio?
    private var continuation: CheckedContinuation<SmartLinkWANSession, any Error>?
    private var pingTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var completed = false

    public init(
        idToken: String,
        preferredSerial: String = "",
        onDisconnect: @escaping DisconnectHandler = { _ in }
    ) {
        self.idToken = idToken
        self.preferredSerial = preferredSerial
        self.onDisconnect = onDisconnect
    }

    public func connect() async throws -> SmartLinkWANSession {
        let tls = NWProtocolTLS.Options()
        let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
        let newConnection = NWConnection(host: "smartlink.flexradio.com", port: 443, using: parameters)
        connection = newConnection
        newConnection.stateUpdateHandler = { [weak self] state in
            Task { await self?.handle(state) }
        }
        newConnection.start(queue: queue)
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(12))
            guard !Task.isCancelled else { return }
            await self?.fail("SmartLink broker timed out waiting for the radio.")
        }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    public func stop() {
        pingTask?.cancel()
        pingTask = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        connection?.cancel()
        connection = nil
        if !completed {
            completed = true
            continuation?.resume(throwing: SmartLinkBrokerError.disconnected("SmartLink broker stopped."))
            continuation = nil
        }
    }

    private func handle(_ state: NWConnection.State) {
        switch state {
        case .ready:
            send("application register name=OM0RX-xCat platform=macOS token=\(idToken)\n")
            receive()
            startPing()
        case let .failed(error): fail("SmartLink broker failed: \(error.localizedDescription)")
        case let .waiting(error): fail("SmartLink broker waiting: \(error.localizedDescription)")
        case .cancelled:
            if connection != nil { fail("SmartLink broker disconnected.") }
        default: break
        }
    }

    private func receive() {
        guard let connection else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, complete, error in
            Task {
                guard let self else { return }
                if let data, !data.isEmpty { await self.consume(data) }
                if complete || error != nil {
                    await self.fail(error.map { "SmartLink broker receive failed: \($0.localizedDescription)" } ?? "SmartLink broker closed.")
                } else {
                    await self.receive()
                }
            }
        }
    }

    private func consume(_ data: Data) {
        buffer.append(data)
        if buffer.count > 1_048_576 {
            fail("SmartLink broker response exceeded the safety limit.")
            return
        }
        while let newline = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer[..<newline]
            buffer.removeSubrange(...newline)
            guard let line = String(data: lineData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !line.isEmpty else { continue }
            parse(line)
        }
    }

    private func parse(_ line: String) {
        if line.hasPrefix("application registration_invalid") {
            fail("SmartLink rejected the login token.")
            return
        }
        if line.hasPrefix("radio list ") {
            if completed { return }
            let radios = SmartLinkBrokerParser.radios(from: line)
            let chosen: SmartLinkRadio?
            if preferredSerial.isEmpty {
                chosen = radios.first(where: { $0.status.lowercased().contains("available") }) ?? radios.first
            } else {
                chosen = radios.first(where: { $0.serial == preferredSerial })
            }
            guard let chosen else {
                finish(throwing: SmartLinkBrokerError.noRadio)
                return
            }
            selectedRadio = chosen
            send("application connect serial=\(chosen.serial) hole_punch_port=0\n")
            return
        }
        if let ready = SmartLinkBrokerParser.connectReady(from: line) {
            guard let radio = selectedRadio, radio.serial == ready.serial else {
                finish(throwing: SmartLinkBrokerError.malformedResponse)
                return
            }
            finish(returning: SmartLinkWANSession(radio: radio, validationHandle: ready.handle))
        }
    }

    private func startPing() {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { return }
                await self?.send("ping from client\n")
            }
        }
    }

    private func send(_ value: String) {
        connection?.send(content: Data(value.utf8), completion: .contentProcessed { _ in })
    }

    private func fail(_ message: String) {
        finish(throwing: SmartLinkBrokerError.disconnected(message))
        onDisconnect(message)
    }

    private func finish(returning session: SmartLinkWANSession) {
        guard !completed else { return }
        completed = true
        timeoutTask?.cancel()
        timeoutTask = nil
        continuation?.resume(returning: session)
        continuation = nil
    }

    private func finish(throwing error: any Error) {
        guard !completed else { return }
        completed = true
        timeoutTask?.cancel()
        timeoutTask = nil
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
