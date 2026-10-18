import Foundation

public struct ContestRateMetric: Codable, Hashable, Sendable {
    public let qsoCount: Int
    public let spanSeconds: Double?
    public let qsosPerHour: Double?

    public init(qsoCount: Int, spanSeconds: Double?, qsosPerHour: Double?) {
        self.qsoCount = qsoCount
        self.spanSeconds = spanSeconds
        self.qsosPerHour = qsosPerHour
    }
}

public struct ContestOperatorStyleStatistics: Codable, Hashable, Sendable {
    public let run: Int
    public let searchAndPounce: Int
    public let unknown: Int

    public init(run: Int, searchAndPounce: Int, unknown: Int) {
        self.run = run
        self.searchAndPounce = searchAndPounce
        self.unknown = unknown
    }
}

public struct ContestModeStatistics: Codable, Hashable, Sendable {
    public let cw: Int
    public let phone: Int
    public let digital: Int
    public let other: Int

    public init(cw: Int, phone: Int, digital: Int, other: Int) {
        self.cw = cw
        self.phone = phone
        self.digital = digital
        self.other = other
    }
}

public struct ContestBandStatistics: Codable, Hashable, Sendable {
    public let band: String
    public let loggedQSOs: Int
    public let acceptedQSOs: Int
    public let distinctCallsigns: Int
    public let modes: ContestModeStatistics
    public let distinctWPXPrefixes: Int
    public let creditedPoints: Int64

    public init(band: String, loggedQSOs: Int, acceptedQSOs: Int, distinctCallsigns: Int,
                modes: ContestModeStatistics, distinctWPXPrefixes: Int, creditedPoints: Int64) {
        self.band = band
        self.loggedQSOs = loggedQSOs
        self.acceptedQSOs = acceptedQSOs
        self.distinctCallsigns = distinctCallsigns
        self.modes = modes
        self.distinctWPXPrefixes = distinctWPXPrefixes
        self.creditedPoints = creditedPoints
    }
}

/// Optional persisted facts attached to a QSO for source-compatible statistics.
/// A missing row or nil style is deliberately counted as unknown; callers must
/// never infer historical operating style from current UI state.
public struct ContestRateQSOFacts: Codable, Hashable, Sendable {
    public let qsoID: UUID
    public let operatorStyle: ContestOperatorStyle?
    public let wpxPrefix: String?

    public init(qsoID: UUID, operatorStyle: ContestOperatorStyle?, wpxPrefix: String?) {
        self.qsoID = qsoID
        self.operatorStyle = operatorStyle
        self.wpxPrefix = wpxPrefix
    }
}

public struct ContestRateStatisticsSnapshot: Codable, Hashable, Sendable {
    public let asOfUTC: Date
    public let fullLogQSOs: Int
    public let loggedQSOs: Int
    public let acceptedQSOs: Int
    public let duplicateQSOs: Int
    public let invalidQSOs: Int
    public let currentHourQSOs: Int
    public let totalOperatorStyles: ContestOperatorStyleStatistics
    public let currentHourOperatorStyles: ContestOperatorStyleStatistics
    public let trailing60Minutes: ContestRateMetric
    public let latest10: ContestRateMetric?
    public let latest100: ContestRateMetric?
    public let bands: [ContestBandStatistics]
    public let total: ContestBandStatistics

    public init(asOfUTC: Date, fullLogQSOs: Int, loggedQSOs: Int, acceptedQSOs: Int, duplicateQSOs: Int,
                invalidQSOs: Int, currentHourQSOs: Int,
                totalOperatorStyles: ContestOperatorStyleStatistics,
                currentHourOperatorStyles: ContestOperatorStyleStatistics,
                trailing60Minutes: ContestRateMetric, latest10: ContestRateMetric?,
                latest100: ContestRateMetric?, bands: [ContestBandStatistics],
                total: ContestBandStatistics) {
        self.asOfUTC = asOfUTC
        self.fullLogQSOs = fullLogQSOs
        self.loggedQSOs = loggedQSOs
        self.acceptedQSOs = acceptedQSOs
        self.duplicateQSOs = duplicateQSOs
        self.invalidQSOs = invalidQSOs
        self.currentHourQSOs = currentHourQSOs
        self.totalOperatorStyles = totalOperatorStyles
        self.currentHourOperatorStyles = currentHourOperatorStyles
        self.trailing60Minutes = trailing60Minutes
        self.latest10 = latest10
        self.latest100 = latest100
        self.bands = bands
        self.total = total
    }
}

public enum ContestRateStatisticsError: Error, Equatable {
    case invalidClock
    case inconsistentScore
    case inconsistentFacts
    case arithmeticOverflow
}

public enum ContestRateStatisticsCalculator {
    public static func snapshot(qsos: [ContestQSO], score: ContestScore,
                                facts: [ContestRateQSOFacts] = [], asOfUTC: Date,
                                preferredBandOrder: [String] = []) throws -> ContestRateStatisticsSnapshot {
        guard asOfUTC.timeIntervalSinceReferenceDate.isFinite else {
            throw ContestRateStatisticsError.invalidClock
        }
        let qsoIDs = Set(qsos.map(\.id))
        guard qsoIDs.count == qsos.count,
              score.qsos.allSatisfy({ qsoIDs.contains($0.qsoID) }),
              Set(score.qsos.map(\.qsoID)).count == score.qsos.count else {
            throw ContestRateStatisticsError.inconsistentScore
        }
        let scored = Dictionary(uniqueKeysWithValues: score.qsos.map { ($0.qsoID, $0) })
        guard scored.count == qsos.count else { throw ContestRateStatisticsError.inconsistentScore }
        let factIDs = Set(facts.map(\.qsoID))
        guard factIDs.count == facts.count, factIDs.isSubset(of: qsoIDs) else {
            throw ContestRateStatisticsError.inconsistentFacts
        }
        let factsByID = Dictionary(uniqueKeysWithValues: facts.map { ($0.qsoID, $0) })
        let visible = qsos.filter { $0.timestampUTC <= asOfUTC }.sorted(by: deterministicOrder)
        let trailing = visible.filter { $0.timestampUTC > asOfUTC.addingTimeInterval(-3_600) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let hourStart = calendar.dateInterval(of: .hour, for: asOfUTC)?.start else {
            throw ContestRateStatisticsError.invalidClock
        }
        let currentHour = visible.filter { $0.timestampUTC > hourStart }
        let rows = try bandRows(visible, scored: scored, facts: factsByID,
                                preferredBandOrder: preferredBandOrder)
        let total = try statistics(band: "total", qsos: visible, scored: scored,
                                   facts: factsByID, totalAcrossBands: true)
        let dispositions = visible.compactMap { scored[$0.id]?.disposition }
        return ContestRateStatisticsSnapshot(
            asOfUTC: asOfUTC,
            fullLogQSOs: qsos.count,
            loggedQSOs: visible.count,
            acceptedQSOs: dispositions.filter { $0 == .accepted }.count,
            duplicateQSOs: dispositions.filter { $0 == .duplicate }.count,
            invalidQSOs: dispositions.filter { $0 == .invalid }.count,
            currentHourQSOs: currentHour.count,
            totalOperatorStyles: styleStatistics(visible, facts: factsByID),
            currentHourOperatorStyles: styleStatistics(currentHour, facts: factsByID),
            trailing60Minutes: rate(trailing, singleContactRate: 1),
            latest10: visible.count >= 10 ? rate(Array(visible.suffix(10)), singleContactRate: nil) : nil,
            latest100: visible.count >= 100 ? rate(Array(visible.suffix(100)), singleContactRate: nil) : nil,
            bands: rows,
            total: total
        )
    }

    private static func rate(_ qsos: [ContestQSO], singleContactRate: Double?) -> ContestRateMetric {
        guard !qsos.isEmpty else { return ContestRateMetric(qsoCount: 0, spanSeconds: nil, qsosPerHour: nil) }
        guard qsos.count > 1 else {
            return ContestRateMetric(qsoCount: 1, spanSeconds: nil, qsosPerHour: singleContactRate)
        }
        let span = qsos.last!.timestampUTC.timeIntervalSince(qsos.first!.timestampUTC)
        guard span > 0, span.isFinite else {
            return ContestRateMetric(qsoCount: qsos.count, spanSeconds: nil, qsosPerHour: nil)
        }
        return ContestRateMetric(qsoCount: qsos.count, spanSeconds: span,
                                 qsosPerHour: Double(qsos.count) * 3_600 / span)
    }

    private static func bandRows(_ qsos: [ContestQSO], scored: [UUID: ContestScoredQSO],
                                 facts: [UUID: ContestRateQSOFacts],
                                 preferredBandOrder: [String]) throws -> [ContestBandStatistics] {
        let grouped = Dictionary(grouping: qsos, by: \.band)
        var order: [String: Int] = [:]
        for band in preferredBandOrder.map({ $0.lowercased() }) where order[band] == nil {
            order[band] = order.count
        }
        let bands = grouped.keys.sorted {
            switch (order[$0], order[$1]) {
            case let (.some(left), .some(right)): return left < right
            case (.some, .none): return true
            case (.none, .some): return false
            case (.none, .none): return $0 < $1
            }
        }
        return try bands.map {
            try statistics(band: $0, qsos: grouped[$0] ?? [], scored: scored,
                           facts: facts, totalAcrossBands: false)
        }
    }

    private static func statistics(band: String, qsos: [ContestQSO],
                                   scored: [UUID: ContestScoredQSO],
                                   facts: [UUID: ContestRateQSOFacts],
                                   totalAcrossBands: Bool) throws -> ContestBandStatistics {
        var cw = 0, phone = 0, digital = 0, other = 0
        var points: Int64 = 0
        for qso in qsos {
            switch modeBucket(qso.mode) {
            case .cw: cw += 1
            case .phone: phone += 1
            case .digital: digital += 1
            case .other: other += 1
            }
            let result = points.addingReportingOverflow(scored[qso.id]?.points ?? 0)
            guard !result.overflow else { throw ContestRateStatisticsError.arithmeticOverflow }
            points = result.partialValue
        }
        let wpxValues = Set(qsos.compactMap { qso -> String? in
            guard let prefix = facts[qso.id]?.wpxPrefix?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !prefix.isEmpty else { return nil }
            return totalAcrossBands ? "\(qso.band):\(prefix.uppercased())" : prefix.uppercased()
        })
        return ContestBandStatistics(
            band: band,
            loggedQSOs: qsos.count,
            acceptedQSOs: qsos.filter { scored[$0.id]?.disposition == .accepted }.count,
            distinctCallsigns: Set(qsos.map(\.callsign)).count,
            modes: ContestModeStatistics(cw: cw, phone: phone, digital: digital, other: other),
            distinctWPXPrefixes: wpxValues.count,
            creditedPoints: points
        )
    }

    private static func styleStatistics(_ qsos: [ContestQSO], facts: [UUID: ContestRateQSOFacts])
        -> ContestOperatorStyleStatistics {
        var run = 0, searchAndPounce = 0, unknown = 0
        for qso in qsos {
            switch facts[qso.id]?.operatorStyle {
            case .run: run += 1
            case .searchAndPounce: searchAndPounce += 1
            case nil: unknown += 1
            }
        }
        return ContestOperatorStyleStatistics(run: run, searchAndPounce: searchAndPounce, unknown: unknown)
    }

    private enum ModeBucket { case cw, phone, digital, other }
    private static func modeBucket(_ raw: String) -> ModeBucket {
        switch raw.uppercased() {
        case "CW", "CW-U", "CW-L", "CW-R", "CWR": return .cw
        case "LSB", "USB", "SSB", "FM", "AM": return .phone
        case "FT8", "FT4", "RTTY", "PSK31", "FSK441", "MSK144", "JT65", "JT9", "Q65": return .digital
        default: return .other
        }
    }

    private static func deterministicOrder(_ lhs: ContestQSO, _ rhs: ContestQSO) -> Bool {
        if lhs.timestampUTC != rhs.timestampUTC { return lhs.timestampUTC < rhs.timestampUTC }
        return lhs.id.uuidString < rhs.id.uuidString
    }
}
