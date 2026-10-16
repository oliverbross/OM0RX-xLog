import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
import XClusterIntegrationCore
@testable import XLogPrototypeSupport

@Suite("Passive operating goal context")
struct OperatingGoalTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func item(id: String = "one", call: String = "K1ABC", reference: String = "K-0001",
                      kind: String = "pota", age: TimeInterval = 30, lifetime: TimeInterval = 60,
                      startsAt: Date? = nil) -> PublicOpportunity {
        PublicOpportunity(id: id, kind: kind, callsign: call, reference: reference, name: "Published activity",
            frequencyHz: 14_200_000, mode: "USB", observedAt: now.addingTimeInterval(-age),
            expiresAt: now.addingTimeInterval(lifetime), source: "Official feed", sourceURL: "https://example.test/feed",
            comment: "", startsAt: startsAt)
    }

    @Test("Station scope, deletion, exact slots and local confirmation remain separate from credit")
    func history() throws {
        let goal = OperatingGoal.entitySlot(dxcc: 291, band: " 20M ", mode: "USB")
        var qso = QSO(call: "K1ABC", start: now.addingTimeInterval(-100), band: "20m", mode: "SSB", dxcc: 291,
                      stationProfileID: 7, myCall: "OM0RX", lotwReceived: "Y")
        var other = qso; other.id = UUID(); other.stationProfileID = 8
        var deleted = qso; deleted.id = UUID(); deleted.deletedAt = now
        var wrongMode = qso; wrongMode.id = UUID(); wrongMode.submode = "FT8"
        let context = OperatingGoalContext(now: now, stationProfileID: 7, stationCall: "om0rx")
        let before = [qso, other, deleted, wrongMode]
        let result = try #require(OperatingGoalEvaluator.evaluate(goals: [goal], context: context,
            contacts: before, opportunities: []).first)
        #expect(result.workedCount == 1)
        #expect(result.confirmedCount == 1)
        #expect(result.evidenceEligible == nil)
        #expect(result.credited == nil)
        #expect(result.evidence.isEmpty)
        qso.lotwReceived = ""; qso.extraFields["EQSL_QSL_RCVD"] = "Y"
        let eqslOnly = try #require(OperatingGoalEvaluator.evaluate(goals: [goal], context: context,
            contacts: [qso], opportunities: []).first)
        #expect(eqslOnly.worked && !eqslOnly.confirmed)
    }

    @Test("Permutations and duplicate goals/evidence give the same ranked projection")
    func deterministic() throws {
        let call = OperatingGoal.callsign(" k1abc ")
        let reference = OperatingGoal.reference(kind: "POTA", reference: "k-0001")
        let missing = OperatingGoal.callsign("JA1XYZ")
        let old = item(id: "old", age: 60)
        let latest = item(id: "latest")
        let tie = item(id: "z")
        let context = OperatingGoalContext(now: now)
        let first = OperatingGoalEvaluator.evaluate(goals: [missing, call, reference, call], context: context,
            contacts: [], opportunities: [old, tie, latest])
        let second = OperatingGoalEvaluator.evaluate(goals: [reference, call, missing], context: context,
            contacts: [], opportunities: [latest, old, tie])
        #expect(first == second)
        #expect(first.map(\.goal.id) == ["call:K1ABC", "reference:pota:K-0001", "call:JA1XYZ"])
        #expect(first[0].evidence.map(\.id) == ["latest"])
        #expect(first[0].evidence[0].ageSeconds == 30)
        #expect(first[0].evidence[0].sourceURL == "https://example.test/feed")
        let otherZone = OperatingGoalEvaluator.evaluate(goals: [reference, call, missing],
            context: .init(now: now, timeZone: TimeZone(identifier: "Australia/Darwin")!),
            contacts: [], opportunities: [latest, old, tie])
        #expect(first == otherZone)
    }

    @Test("Expired and future-dated evidence cannot rank; scheduled calendar windows stay explicit")
    func freshness() throws {
        let goal = OperatingGoal.callsign("K1ABC")
        let scheduled = item(startsAt: now.addingTimeInterval(10))
        let result = try #require(OperatingGoalEvaluator.evaluate(goals: [goal], context: .init(now: now),
            contacts: [], opportunities: [item(id: "expired", lifetime: 0), item(id: "future", age: -1), scheduled]).first)
        #expect(result.evidence.count == 1)
        #expect(result.evidence[0].freshness == "scheduled")
        #expect(result.evidence[0].reason.contains("unverified"))
        let advanced = OperatingGoalEvaluator.evaluate(goals: [goal], context: .init(now: now.addingTimeInterval(60)),
            contacts: [], opportunities: [scheduled])
        #expect(advanced.first?.evidence.isEmpty == true)
        #expect(OperatingGoalEvaluator.evaluate(goals: [goal], context: .init(now: now, maximumSpotAge: .nan),
            contacts: [], opportunities: [scheduled]).isEmpty)
    }

    @Test("Explicit IOTA and calendar aliases match; unknown entity metadata never becomes a slot")
    func referencesAndAliases() throws {
        var calendar = item(reference: "EU-001", kind: "dxpedition")
        calendar.frequencyHz = nil; calendar.mode = ""; calendar.callsigns = ["K1ABC", "K2ABC"]
        let goals: [OperatingGoal] = [.reference(kind: "iota", reference: "EU-001"), .callsign("K2ABC"),
            .entitySlot(dxcc: 291, band: "20m", mode: "SSB"), .reference(kind: "unknown", reference: "EU-001")]
        let result = OperatingGoalEvaluator.evaluate(goals: goals, context: .init(now: now),
            contacts: [QSO(call: "K1ABC", start: now.addingTimeInterval(-100), band: "20m", mode: "SSB", iota: "EU-002; EU-001")],
            opportunities: [calendar])
        #expect(result.count == 3)
        #expect(result.first { $0.goal == .callsign("K2ABC") }?.evidence.count == 1)
        #expect(result.first { $0.goal == .reference(kind: "iota", reference: "EU-001") }?.worked == true)
        #expect(result.first { $0.goal == .entitySlot(dxcc: 291, band: "20m", mode: "SSB") }?.evidence.isEmpty == true)
        #expect(calendar.frequencyHz == nil)
        let slot = OperatingGoal.entitySlot(dxcc: 291, band: "20m", mode: "SSB")
        let resolved = OperatingGoalEvaluator.evaluate(goals: [slot], context: .init(now: now), contacts: [],
            opportunities: [item()], resolver: try CTYResolver.bundled())
        #expect(resolved.first?.evidence.count == 1)
    }

    @Test("Retained cluster evidence expires from report time, not a later arrival")
    func retainedSpotAge() throws {
        let clusterID = UUID()
        // Decode the existing observation DTO without creating a cluster transport.
        let classified: [String: Any] = [
            "id": UUID().uuidString, "receivedAt": now.timeIntervalSinceReferenceDate,
            "clusterName": "Fixture", "spotter": "W1AW", "frequencyKHz": 14200,
            "frequencyText": "14200", "callsign": "K1ABC", "comment": "POTA K-0001",
            "band": "20m", "mode": "SSB", "country": "United States", "adif": 291,
            "continent": "NA", "callStatus": "New Callsign", "dxccStatus": "New DXCC", "specialTags": ["POTA"],
            "score": 0, "scoreReasons": [], "aggregateCount": 1, "aggregateSpotters": ["W1AW"],
            "source": "cluster", "statusHex": "", "bandHex": "", "modeHex": ""
        ]
        let value = try JSONDecoder().decode(ClassifiedClusterSpot.self,
            from: JSONSerialization.data(withJSONObject: classified))
        let raw = RawSpot(clusterID: clusterID, clusterName: "Fixture", spotter: "W1AW",
            frequencyKHz: 14200, frequencyText: "14200", callsign: "K1ABC", comment: "POTA K-0001", receivedAt: now)
        func observation(age: TimeInterval) -> ClusterSpotObservation {
            ClusterSpotObservation(sessionID: UUID(), sequence: 1, clusterID: clusterID, clusterName: "Fixture",
                clusterHost: "fixture.invalid", clusterPort: 7300, transportGeneration: UUID(), arrivedAt: now,
                reportedAt: now.addingTimeInterval(-age), timeBasis: "explicit_report_date", recordKind: "historical_reply",
                rawLine: "Fixture", raw: raw, classified: value, contactRevision: 1)
        }
        let goals: [OperatingGoal] = [.callsign("K1ABC"), .reference(kind: "pota", reference: "K-0001"),
                                     .entitySlot(dxcc: 291, band: "20m", mode: "SSB")]
        let stale = OperatingGoalEvaluator.evaluate(goals: goals, context: .init(now: now), contacts: [],
            opportunities: [], spots: [observation(age: 1_800)])
        #expect(stale.allSatisfy { $0.evidence.isEmpty })
        let recent = OperatingGoalEvaluator.evaluate(goals: goals, context: .init(now: now), contacts: [],
            opportunities: [], spots: [observation(age: 60)])
        #expect(recent.allSatisfy { $0.evidence.count == 1 && $0.evidence[0].ageSeconds == 60 })
        let future = OperatingGoalEvaluator.evaluate(goals: goals, context: .init(now: now), contacts: [],
            opportunities: [], spots: [observation(age: -1)])
        #expect(future.allSatisfy { $0.evidence.isEmpty })
    }
}
