import Foundation

/// Preserve Agent transaction/rollback codes across the worker boundary.
public struct RemoteAgentCommandFailure: LocalizedError, Sendable {
    public let code: String
    public let message: String
    public init(code: String, message: String) { self.code = code; self.message = message }
    public var errorDescription: String? { message }
}

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
