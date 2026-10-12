import Foundation

/// Parsed cluster input; frequency is in kHz and the original decimal text is retained.
public struct RawSpot: Codable, Hashable, Sendable {
    public var clusterID: UUID
    public var clusterName: String
    public var spotter: String
    public var frequencyKHz: Double
    public var frequencyText: String
    public var callsign: String
    public var comment: String
    public var receivedAt: Date

    public init(clusterID: UUID, clusterName: String, spotter: String, frequencyKHz: Double,
                frequencyText: String, callsign: String, comment: String, receivedAt: Date) {
        self.clusterID = clusterID
        self.clusterName = clusterName
        self.spotter = spotter
        self.frequencyKHz = frequencyKHz
        self.frequencyText = frequencyText
        self.callsign = callsign
        self.comment = comment
        self.receivedAt = receivedAt
    }
}

/// Minimum caller-supplied contact projection used for spot classification.
public struct ClusterContact: Codable, Hashable, Sendable {
    public var callsign: String
    public var band: String
    public var mode: String
    public var adif: Int?
    public var date: Date
    public var paperQSL: String
    public var lotwQSL: String
    public var eqsl: String

    public init(callsign: String, band: String, mode: String, adif: Int? = nil,
                date: Date = .distantPast, paperQSL: String = "", lotwQSL: String = "", eqsl: String = "") {
        self.callsign = callsign
        self.band = band
        self.mode = mode
        self.adif = adif
        self.date = date
        self.paperQSL = paperQSL
        self.lotwQSL = lotwQSL
        self.eqsl = eqsl
    }

    /// Original xCluster award semantics: eQSL alone is not a DXCC confirmation.
    public var isConfirmed: Bool { Self.confirmed(paperQSL) || Self.confirmed(lotwQSL) }

    private static func confirmed(_ value: String) -> Bool {
        ["X", "Y", "YES", "TRUE", "1", "C", "CONFIRMED"].contains(
            value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())
    }
}

public struct ClusterClassification: Codable, Hashable, Sendable {
    public let callStatus: String
    public let dxccStatus: String
    public let workedBefore: Date?

    public init(callStatus: String, dxccStatus: String, workedBefore: Date?) {
        self.callStatus = callStatus
        self.dxccStatus = dxccStatus
        self.workedBefore = workedBefore
    }
}
