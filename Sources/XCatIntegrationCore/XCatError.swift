import Foundation

public enum XCatError: LocalizedError, Sendable {
    case invalidFrequency
    case invalidMode
    case notConnected
    case unsupported
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .invalidFrequency: "The frequency is invalid."
        case .invalidMode: "The radio mode is invalid."
        case .notConnected: "The radio is not connected."
        case .unsupported: "This operation is not supported by the selected radio connection."
        case let .server(message): message
        }
    }
}
