import Foundation

public struct AwardProgressSnapshot: Codable, Equatable, Sendable {
    public var qsoCount: Int
    public var confirmedQSOs: Int
    public var dxccWorked: Int
    public var dxccConfirmed: Int
    public var cqZonesWorked: Int
    public var cqZonesConfirmed: Int
    public var statesWorked: Int
    public var statesConfirmed: Int
    public var gridsWorked: Int
    public var gridsConfirmed: Int
    public var modeCounts: [String: Int]
    public var bandCounts: [String: Int]
    public var continentCounts: [String: Int]
    public var yearCounts: [String: Int]

    public init(
        qsoCount: Int = 0,
        confirmedQSOs: Int = 0,
        dxccWorked: Int = 0,
        dxccConfirmed: Int = 0,
        cqZonesWorked: Int = 0,
        cqZonesConfirmed: Int = 0,
        statesWorked: Int = 0,
        statesConfirmed: Int = 0,
        gridsWorked: Int = 0,
        gridsConfirmed: Int = 0,
        modeCounts: [String: Int] = [:],
        bandCounts: [String: Int] = [:],
        continentCounts: [String: Int] = [:],
        yearCounts: [String: Int] = [:]
    ) {
        self.qsoCount = qsoCount
        self.confirmedQSOs = confirmedQSOs
        self.dxccWorked = dxccWorked
        self.dxccConfirmed = dxccConfirmed
        self.cqZonesWorked = cqZonesWorked
        self.cqZonesConfirmed = cqZonesConfirmed
        self.statesWorked = statesWorked
        self.statesConfirmed = statesConfirmed
        self.gridsWorked = gridsWorked
        self.gridsConfirmed = gridsConfirmed
        self.modeCounts = modeCounts
        self.bandCounts = bandCounts
        self.continentCounts = continentCounts
        self.yearCounts = yearCounts
    }

    public static let empty = AwardProgressSnapshot()

    public var achievements: [AwardAchievement] {
        let definitions: [(String, String, String, Int, Int)] = [
            ("DXCC", "globe.americas.fill", "DXCC entities", dxccWorked, 100),
            ("WAZ", "location.north.circle.fill", "CQ zones", cqZonesWorked, 40),
            ("WAS", "flag.fill", "US states", statesWorked, 50),
            ("GRID", "square.grid.3x3.fill", "Maidenhead fields", gridsWorked, nextGridTarget),
            ("QSO", "waveform.path.ecg", "Contacts", qsoCount, nextQSOTarget),
        ]
        return definitions.map { code, symbol, title, current, target in
            AwardAchievement(code: code, symbol: symbol, title: title, current: current, target: target)
        }
    }

    private var nextGridTarget: Int { Self.nextTarget(after: gridsWorked, values: [25, 50, 100, 250, 500, 1_000, 2_500]) }
    private var nextQSOTarget: Int { Self.nextTarget(after: qsoCount, values: [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000]) }

    private static func nextTarget(after value: Int, values: [Int]) -> Int {
        values.first(where: { $0 > value }) ?? max(value, values.last ?? 1)
    }
}

public struct AwardAchievement: Identifiable, Equatable, Sendable {
    public var code: String
    public var symbol: String
    public var title: String
    public var current: Int
    public var target: Int
    public var id: String { code }
    public var completed: Bool { current >= target }
    public var fraction: Double { min(1, Double(current) / Double(max(1, target))) }
}

