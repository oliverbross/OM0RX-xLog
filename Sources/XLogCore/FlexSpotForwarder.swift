import Darwin
import Foundation

public enum FlexSpotForwarderError: Error {
    case invalidHost
    case socket(String)
    case send(String)
}

public enum FlexSpotForwarder {
    public static func rumlogXML(for spot: ClusterSpot) -> Data {
        let status = spot.callStatus.lowercased()
        let dxcc = spot.dxccStatus.lowercased()
        let fields: [(String, String)] = [
            ("dxcall", spot.callsign.uppercased()),
            ("frequency", String(format: "%.3f", spot.frequencyKHz)),
            ("mode", spot.mode.uppercased()),
            ("spottercall", spot.source),
            ("stationname", "OM0RX-xLog"),
            ("comment", spot.comment),
            ("timestamp", String(Int64(spot.receivedAt.timeIntervalSince1970))),
            ("wkdB4", status == "worked" ? "1" : "0"),
            ("dxccNotCfd", dxcc == "confirmed" ? "0" : "1"),
            ("bandNotCfd", status.contains("new callsign") ? "1" : "0"),
            ("modeNotCfd", status.contains("new mode") ? "1" : "0"),
            ("slotNotCfd", status.contains("band+mode") ? "1" : "0"),
        ]
        let body = fields.map { "<\($0.0)>\(escaped($0.1))</\($0.0)>" }.joined()
        return Data("<?xml version=\"1.0\" encoding=\"UTF-8\"?><spot>\(body)</spot>".utf8)
    }

    public static func send(_ spot: ClusterSpot, host: String = "127.0.0.1", port: UInt16 = 12_062) throws {
        let descriptor = socket(AF_INET, SOCK_DGRAM, 0)
        guard descriptor >= 0 else { throw FlexSpotForwarderError.socket(String(cString: strerror(errno))) }
        defer { close(descriptor) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        let normalizedHost = host == "localhost" ? "127.0.0.1" : host
        guard inet_pton(AF_INET, normalizedHost, &address.sin_addr) == 1 else {
            throw FlexSpotForwarderError.invalidHost
        }
        let payload = rumlogXML(for: spot)
        let sent = payload.withUnsafeBytes { bytes in
            withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                    Darwin.sendto(descriptor, bytes.baseAddress, bytes.count, 0, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
        guard sent == payload.count else { throw FlexSpotForwarderError.send(String(cString: strerror(errno))) }
    }

    private static func escaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }
}
