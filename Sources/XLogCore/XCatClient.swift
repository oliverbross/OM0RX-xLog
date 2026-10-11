import Darwin
import Foundation

public struct RadioSnapshot: Equatable, Sendable {
    public let frequencyHz: Int64
    public let mode: String
}

public enum XCatClientError: Error, LocalizedError {
    case invalidHost
    case connect(String)
    case write
    case read
    case invalidResponse
    public var errorDescription: String? {
        switch self {
        case .invalidHost: return "xCat host must be a valid IPv4 address or localhost."
        case let .connect(message): return "Could not connect to OM0RX-xCat: \(message)"
        case .write: return "Could not send a command to OM0RX-xCat."
        case .read: return "OM0RX-xCat closed the command connection."
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

    public func tune(frequencyHz: Int64, mode: String) throws {
        guard try command("F \(frequencyHz)").contains("RPRT 0") else { throw XCatClientError.invalidResponse }
        let radioMode = radioMode(for: mode, frequencyHz: frequencyHz)
        guard try command("M \(radioMode) 0").contains("RPRT 0") else { throw XCatClientError.invalidResponse }
    }

    private func command(_ command: String) throws -> String {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw XCatClientError.connect(String(cString: strerror(errno))) }
        defer { close(descriptor) }
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
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
        var bytes = [UInt8](repeating: 0, count: 4096)
        let count = recv(descriptor, &bytes, bytes.count, 0)
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
