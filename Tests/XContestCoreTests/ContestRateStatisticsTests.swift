import Foundation
import Testing
@testable import XContestCore

struct ContestRateStatisticsTests {
    private let sessionID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    private let now = ISO8601DateFormatter().date(from: "2026-10-18T12:30:00Z")!

    @Test("Logged contacts drive source-compatible rolling and latest-N rates")
    func rates() throws {
        var qsos: [ContestQSO] = []
        var scored: [ContestScoredQSO] = []
        for index in 0..<105 {
            let qso = qso(index, secondsBeforeNow: Double((104 - index) * 60), band: "20m", mode: "CW")
            qsos.append(qso)
            scored.append(score(qso, disposition: index == 50 ? .duplicate : .accepted, points: 1))
        }
        let snapshot = try ContestRateStatisticsCalculator.snapshot(
            qsos: qsos,
            score: ContestScore(qsos: scored, totalPoints: 104, multiplierCount: 0, claimedScore: 104),
            asOfUTC: now
        )
        #expect(snapshot.loggedQSOs == 105)
        #expect(snapshot.acceptedQSOs == 104)
        #expect(snapshot.duplicateQSOs == 1)
        #expect(snapshot.trailing60Minutes.qsoCount == 60)
        #expect(abs((snapshot.trailing60Minutes.qsosPerHour ?? 0) - (3_600 / 59)) < 0.000_001)
        #expect(snapshot.latest10?.qsoCount == 10)
        #expect(abs((snapshot.latest10?.qsosPerHour ?? 0) - (600 / 9)) < 0.000_001)
        #expect(snapshot.latest100?.qsoCount == 100)
        #expect(snapshot.currentHourQSOs == 30)
        #expect(snapshot.total.creditedPoints == 104)
        #expect(snapshot.totalOperatorStyles == .init(run: 0, searchAndPounce: 0, unknown: 105))
    }

    @Test("Single-contact rolling rate is one and zero-duration samples are unavailable")
    func singleAndZeroSpan() throws {
        let single = qso(1, secondsBeforeNow: 10, band: "20m", mode: "CW")
        let one = try ContestRateStatisticsCalculator.snapshot(
            qsos: [single],
            score: ContestScore(qsos: [score(single)], totalPoints: 1, multiplierCount: 0, claimedScore: 1),
            asOfUTC: now
        )
        #expect(one.trailing60Minutes == ContestRateMetric(qsoCount: 1, spanSeconds: nil, qsosPerHour: 1))

        let sameTime = qso(2, secondsBeforeNow: 10, band: "20m", mode: "CW")
        let zero = try ContestRateStatisticsCalculator.snapshot(
            qsos: [single, sameTime],
            score: ContestScore(qsos: [score(single), score(sameTime)], totalPoints: 2,
                                multiplierCount: 0, claimedScore: 2),
            asOfUTC: now
        )
        #expect(zero.trailing60Minutes == ContestRateMetric(qsoCount: 2, spanSeconds: nil, qsosPerHour: nil))
    }

    @Test("Band statistics retain logged dupes while points and accepted counts follow the rescore")
    func bandStatistics() throws {
        let items = [
            qso(1, secondsBeforeNow: 300, band: "40m", mode: "CW", callsign: "K1A"),
            qso(2, secondsBeforeNow: 240, band: "20m", mode: "SSB", callsign: "K1B"),
            qso(3, secondsBeforeNow: 180, band: "20m", mode: "RTTY", callsign: "K1C"),
            qso(4, secondsBeforeNow: 120, band: "20m", mode: "OLIVIA", callsign: "K4D"),
            qso(5, secondsBeforeNow: 60, band: "20m", mode: "CW", callsign: "K4D"),
        ]
        let dispositions: [ContestQSODisposition] = [.accepted, .accepted, .accepted, .accepted, .duplicate]
        let facts = [
            fact(items[0], style: .run, prefix: "K1"),
            fact(items[1], style: .searchAndPounce, prefix: "K1"),
            fact(items[2], style: nil, prefix: "K1"),
            fact(items[3], style: .run, prefix: "K4"),
            fact(items[4], style: .run, prefix: "K4"),
        ]
        let snapshot = try ContestRateStatisticsCalculator.snapshot(
            qsos: items,
            score: ContestScore(qsos: zip(items, dispositions).map { score($0.0, disposition: $0.1, points: 2) },
                                totalPoints: 8, multiplierCount: 0, claimedScore: 8),
            facts: facts,
            asOfUTC: now,
            preferredBandOrder: ["40m", "20m"]
        )
        #expect(snapshot.bands.map(\.band) == ["40m", "20m"])
        #expect(snapshot.bands[1].loggedQSOs == 4)
        #expect(snapshot.bands[1].acceptedQSOs == 3)
        #expect(snapshot.bands[1].distinctCallsigns == 3)
        #expect(snapshot.bands[1].modes == ContestModeStatistics(cw: 1, phone: 1, digital: 1, other: 1))
        #expect(snapshot.bands[1].distinctWPXPrefixes == 2)
        #expect(snapshot.bands[1].creditedPoints == 6)
        #expect(snapshot.total.loggedQSOs == 5)
        #expect(snapshot.total.distinctWPXPrefixes == 3)
        #expect(snapshot.total.creditedPoints == 8)
        #expect(snapshot.totalOperatorStyles == .init(run: 3, searchAndPounce: 1, unknown: 1))
    }

    @Test("Future contacts and exact UTC lower boundaries are excluded")
    func clockBoundaries() throws {
        let hourBoundary = qso(1, secondsBeforeNow: 1_800, band: "20m", mode: "CW")
        let rollingBoundary = qso(2, secondsBeforeNow: 3_600, band: "20m", mode: "CW")
        let inside = qso(3, secondsBeforeNow: 1_799, band: "20m", mode: "CW")
        let future = qso(4, secondsBeforeNow: -1, band: "20m", mode: "CW")
        let qsos = [hourBoundary, rollingBoundary, inside, future]
        let snapshot = try ContestRateStatisticsCalculator.snapshot(
            qsos: qsos,
            score: ContestScore(qsos: qsos.map { score($0) }, totalPoints: 4,
                                multiplierCount: 0, claimedScore: 4),
            asOfUTC: now
        )
        #expect(snapshot.loggedQSOs == 3)
        #expect(snapshot.fullLogQSOs == 4)
        #expect(snapshot.currentHourQSOs == 1)
        #expect(snapshot.trailing60Minutes.qsoCount == 2)
    }

    @Test("Facts are optional but duplicate or foreign fact identities fail closed")
    func factIdentity() {
        let item = qso(1, secondsBeforeNow: 1, band: "20m", mode: "CW")
        let score = ContestScore(qsos: [score(item)], totalPoints: 1, multiplierCount: 0, claimedScore: 1)
        let duplicate = fact(item, style: .run, prefix: "K1")
        #expect(throws: ContestRateStatisticsError.inconsistentFacts) {
            try ContestRateStatisticsCalculator.snapshot(qsos: [item], score: score,
                                                         facts: [duplicate, duplicate], asOfUTC: now)
        }
        let foreign = ContestRateQSOFacts(
            qsoID: UUID(uuidString: "20000000-0000-4000-8000-000000000999")!,
            operatorStyle: .run,
            wpxPrefix: "K1"
        )
        #expect(throws: ContestRateStatisticsError.inconsistentFacts) {
            try ContestRateStatisticsCalculator.snapshot(qsos: [item], score: score,
                                                         facts: [foreign], asOfUTC: now)
        }
    }

    @Test("Score/QSO identity mismatch fails closed")
    func mismatch() {
        let item = qso(1, secondsBeforeNow: 1, band: "20m", mode: "CW")
        #expect(throws: ContestRateStatisticsError.inconsistentScore) {
            try ContestRateStatisticsCalculator.snapshot(
                qsos: [item], score: ContestScore(qsos: [], totalPoints: 0,
                                                  multiplierCount: 0, claimedScore: 0), asOfUTC: now)
        }
    }

    private func fact(_ qso: ContestQSO, style: ContestOperatorStyle?,
                      prefix: String?) -> ContestRateQSOFacts {
        ContestRateQSOFacts(qsoID: qso.id, operatorStyle: style, wpxPrefix: prefix)
    }

    private func qso(_ index: Int, secondsBeforeNow: Double, band: String, mode: String,
                     callsign: String? = nil) -> ContestQSO {
        ContestQSO(
            id: UUID(uuidString: String(format: "20000000-0000-4000-8000-%012x", index))!,
            sessionID: sessionID,
            timestampUTC: now.addingTimeInterval(-secondsBeforeNow),
            callsign: callsign ?? "K\(index)A",
            band: band,
            mode: mode,
            frequencyHz: 14_025_000,
            rstSent: "599",
            rstReceived: "599",
            exchange: ContestExchangeSnapshot(rawSent: "15", normalizedSent: "15",
                                              rawReceived: "14", normalizedReceived: "14"),
            entity: nil,
            provenance: ContestQSOProvenance(source: .operatorEntry)
        )
    }

    private func score(_ qso: ContestQSO, disposition: ContestQSODisposition = .accepted,
                       points: Int64 = 1) -> ContestScoredQSO {
        ContestScoredQSO(qsoID: qso.id, disposition: disposition, issues: [],
                         dupeKey: nil, points: disposition == .accepted ? points : 0,
                         newMultipliers: [])
    }
}
