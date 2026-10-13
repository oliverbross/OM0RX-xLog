import Foundation

/// One accepted report, captured before live aggregation, filtering or eviction.
/// A retry must retain this identity; identical reports on the wire remain distinct.
public struct ClusterSpotObservation: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let sessionID: UUID
    public let sequence: Int64
    public let clusterID: UUID
    public let clusterName: String
    public let clusterHost: String
    public let clusterPort: Int
    public let transportGeneration: UUID
    public let arrivedAt: Date
    public let reportedAt: Date?
    public let timeBasis: String
    public let recordKind: String
    public let rawLine: String
    public let raw: RawSpot
    public let classified: ClassifiedClusterSpot
    public let contactRevision: Int

    public init(id: UUID = UUID(), sessionID: UUID, sequence: Int64, clusterID: UUID,
                clusterName: String, clusterHost: String, clusterPort: Int,
                transportGeneration: UUID, arrivedAt: Date, reportedAt: Date?,
                timeBasis: String, recordKind: String, rawLine: String, raw: RawSpot,
                classified: ClassifiedClusterSpot, contactRevision: Int) {
        self.id = id
        self.sessionID = sessionID
        self.sequence = sequence
        self.clusterID = clusterID
        self.clusterName = clusterName
        self.clusterHost = clusterHost
        self.clusterPort = clusterPort
        self.transportGeneration = transportGeneration
        self.arrivedAt = arrivedAt
        self.reportedAt = reportedAt
        self.timeBasis = timeBasis
        self.recordKind = recordKind
        self.rawLine = rawLine
        self.raw = raw
        self.classified = classified
        self.contactRevision = contactRevision
    }

    /// The parser already validates dated historical replies. Live HHMMZ has no
    /// date: choose the UTC day nearest arrival, moving by a day only when the
    /// clock differs by more than 12 hours. This remains explicitly inferred.
    static func reportTime(line: String, raw: RawSpot, arrivedAt: Date) -> (Date?, String, String) {
        let cleaned = line.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }.map(String.init).joined()
        guard cleaned.lowercased().hasPrefix("dx de") else {
            return (raw.receivedAt, "explicit_report_date", "historical_reply")
        }
        guard let range = cleaned.range(of: #"(?:^|\s)(?:[01]\d|2[0-3])[0-5]\dZ\s*$"#,
                                        options: [.regularExpression, .caseInsensitive]) else {
            return (nil, "arrival", "live")
        }
        let clock = cleaned[range].trimmingCharacters(in: .whitespaces)
        guard let hour = Int(clock.prefix(2)), let minute = Int(clock.dropFirst(2).prefix(2)) else {
            return (nil, "arrival", "live")
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var report = calendar.startOfDay(for: arrivedAt).addingTimeInterval(Double(hour * 3600 + minute * 60))
        let difference = report.timeIntervalSince(arrivedAt)
        if difference > 43_200 { report = report.addingTimeInterval(-86_400) }
        else if difference < -43_200 { report = report.addingTimeInterval(86_400) }
        return (report, "inferred_utc_date", "live")
    }
}

/// A bounded connection transition, containing no credentials or error transcript.
public struct ClusterHistoryConnectionEvent: Codable, Hashable, Sendable {
    public let sessionID: UUID
    public let clusterID: UUID
    public let clusterName: String
    public let clusterHost: String
    public let clusterPort: Int
    public let transportGeneration: UUID
    public let occurredAt: Date
    public let phase: ClusterConnectionPhase

    public init(sessionID: UUID, clusterID: UUID, clusterName: String, clusterHost: String,
                clusterPort: Int, transportGeneration: UUID, occurredAt: Date,
                phase: ClusterConnectionPhase) {
        self.sessionID = sessionID
        self.clusterID = clusterID
        self.clusterName = clusterName
        self.clusterHost = clusterHost
        self.clusterPort = clusterPort
        self.transportGeneration = transportGeneration
        self.occurredAt = occurredAt
        self.phase = phase
    }
}
