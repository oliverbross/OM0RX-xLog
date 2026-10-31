import Foundation

/// Public, non-secret display projection. Coordinates are grid centres or
/// explicitly labelled DXCC approximations, never a home-address lookup.
public struct HMControlContact: Codable, Sendable {
    public let id: String
    public let call: String
    public let band: String
    public let mode: String
    public let start: Date
    public let whereName: String
    public let lat: Double?
    public let lon: Double?
    public let approximate: Bool
    public let confirmed: Bool
    public let adif: Int?
}

public struct HMControlLogbook: Codable, Sendable {
    public let revision: Int64
    public let total: Int
    public let located: Int
    public let approximate: Int
    /// One representative per five-degree cell, at most 2,592 points.
    public let points: [HMControlContact]
    public let recent: [HMControlContact]
    public let baseRevision: Int64?
    public let added: [HMControlContact]
    public let confirmations: [HMControlContact]
    public let confirmedDXCC: [Int]
}
