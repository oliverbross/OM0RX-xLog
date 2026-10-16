import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Read-only adapter from the worker protocol to the shared Swift evaluator.
/// It owns no contacts, feed state, timers, network sessions or station controls.
actor LiveOperatingGoalMethods {
    private let logbook: LiveLogbookMethods
    private let opportunities: LiveOpportunitiesMethods

    init(logbook: LiveLogbookMethods, opportunities: LiveOpportunitiesMethods) {
        self.logbook = logbook
        self.opportunities = opportunities
    }

    func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        guard method == "operating_goals_evaluate" else {
            throw WorkerFailure("method_not_allowed", "Unknown operating goal operation.")
        }
        let input = try Self.input(params)
        let contacts = try logbook.openedDatabase().fetchAll()
        let retainedOpportunities = try await opportunities.retainedItems()
        let context = OperatingGoalContext(now: input.now, stationProfileID: input.stationProfileID,
            stationCall: input.stationCall, maximumSpotAge: input.maximumSpotAge)
        let evaluations = OperatingGoalEvaluator.evaluate(goals: input.goals, context: context,
            contacts: contacts, opportunities: retainedOpportunities,
            resolver: try? CTYResolver.bundled())
        return [
            "evaluated_at": input.now.timeIntervalSince1970,
            "station_scope": [
                "profile_id": input.stationProfileID as Any? ?? NSNull(),
                "callsign": input.stationCall as Any? ?? NSNull(),
                "all_stations": input.stationProfileID == nil && input.stationCall == nil,
            ],
            "sources": [
                "contacts": ["state": "retained", "count": contacts.count],
                "opportunities": ["state": "retained", "count": retainedOpportunities.count],
                "cluster_observations": ["state": "not_included", "count": 0],
            ],
            "evaluations": evaluations.map(Self.projection),
            "read_only": true,
            "tunes": false,
            "transmits": false,
        ]
    }

    private struct Input {
        let goals: [OperatingGoal]
        let now: Date
        let stationProfileID: Int?
        let stationCall: String?
        let maximumSpotAge: TimeInterval
    }

    private static func input(_ params: [String: Any]) throws -> Input {
        let allowed: Set<String> = ["goals", "now", "station_profile_id", "station_call", "maximum_spot_age_seconds"]
        guard Set(params.keys).isSubset(of: allowed), let rawGoals = params["goals"] as? [[String: Any]],
              (1...128).contains(rawGoals.count), let timestamp = number(params["now"]),
              timestamp.isFinite, abs(timestamp) < 32_503_680_000 else { throw invalid() }
        let profile: Int?
        if params["station_profile_id"] == nil || params["station_profile_id"] is NSNull { profile = nil }
        else {
            guard let value = integer(params["station_profile_id"]), (1...Int64(Int.max)).contains(value) else { throw invalid() }
            profile = Int(value)
        }
        let stationCall: String?
        if params["station_call"] == nil || params["station_call"] is NSNull { stationCall = nil }
        else {
            guard let value = params["station_call"] as? String, value.utf8.count <= 32 else { throw invalid() }
            let cleaned = OperatingGoal.clean(value)
            guard !cleaned.isEmpty,
                  cleaned.range(of: #"^[A-Z0-9/]+$"#, options: .regularExpression) != nil else { throw invalid() }
            stationCall = cleaned
        }
        let maximumSpotAge = params["maximum_spot_age_seconds"].flatMap(number) ?? 1_800
        guard maximumSpotAge.isFinite, (1...86_400).contains(maximumSpotAge) else { throw invalid() }
        let goals = try rawGoals.map(goal)
        return Input(goals: goals, now: Date(timeIntervalSince1970: timestamp),
                     stationProfileID: profile, stationCall: stationCall,
                     maximumSpotAge: maximumSpotAge)
    }

    private static func goal(_ value: [String: Any]) throws -> OperatingGoal {
        guard let type = value["type"] as? String else { throw invalid() }
        let goal: OperatingGoal
        switch type {
        case "callsign":
            guard Set(value.keys) == ["type", "callsign"], let call = value["callsign"] as? String,
                  call.utf8.count <= 32 else { throw invalid() }
            goal = .callsign(call)
        case "entity_slot":
            guard Set(value.keys) == ["type", "dxcc", "band", "mode"],
                  let dxcc = integer(value["dxcc"]), (1...999).contains(dxcc),
                  let band = value["band"] as? String, band.utf8.count <= 16,
                  let mode = value["mode"] as? String, mode.utf8.count <= 24 else { throw invalid() }
            goal = .entitySlot(dxcc: Int(dxcc), band: band, mode: mode)
        case "reference":
            guard Set(value.keys) == ["type", "programme", "reference"],
                  let programme = value["programme"] as? String, programme.utf8.count <= 16,
                  let reference = value["reference"] as? String, reference.utf8.count <= 64 else { throw invalid() }
            goal = .reference(kind: programme, reference: reference)
        default: throw invalid()
        }
        guard goal.normalized.isValid else { throw invalid() }
        return goal
    }

    private static func projection(_ value: OperatingGoalEvaluation) -> [String: Any] {
        [
            "goal": goalProjection(value.goal.normalized),
            "worked": value.worked,
            "worked_count": value.workedCount,
            "confirmed": value.confirmed,
            "confirmed_count": value.confirmedCount,
            "evidence_eligible": value.evidenceEligible as Any? ?? NSNull(),
            "credited": value.credited as Any? ?? NSNull(),
            "reasons": value.reasons,
            "evidence": value.evidence.map { evidence in
                [
                    "id": evidence.id,
                    "source": evidence.source,
                    "source_url": evidence.sourceURL,
                    "callsign": evidence.callsign,
                    "reference": evidence.reference,
                    "band": evidence.band,
                    "mode": evidence.mode,
                    "observed_at": evidence.observedAt.timeIntervalSince1970,
                    "time_basis": evidence.timeBasis,
                    "expires_at": evidence.expiresAt.timeIntervalSince1970,
                    "starts_at": evidence.startsAt?.timeIntervalSince1970 as Any? ?? NSNull(),
                    "age_seconds": evidence.ageSeconds,
                    "freshness": evidence.freshness,
                    "reason": evidence.reason,
                ] as [String: Any]
            },
        ]
    }

    private static func goalProjection(_ goal: OperatingGoal) -> [String: Any] {
        switch goal {
        case let .callsign(call): return ["id": goal.id, "type": "callsign", "callsign": call]
        case let .entitySlot(dxcc, band, mode):
            return ["id": goal.id, "type": "entity_slot", "dxcc": dxcc, "band": band, "mode": mode]
        case let .reference(kind, reference):
            return ["id": goal.id, "type": "reference", "programme": kind, "reference": reference]
        }
    }

    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, !isJSONBoolean(number) else { return nil }
        return number.doubleValue
    }

    private static func integer(_ value: Any?) -> Int64? {
        guard let number = number(value), number.rounded() == number,
              number >= Double(Int64.min), number <= Double(Int64.max) else { return nil }
        return Int64(number)
    }

    private static func isJSONBoolean(_ number: NSNumber) -> Bool {
        guard let encoded = try? JSONSerialization.data(withJSONObject: [number]) else { return false }
        return encoded == Data("[true]".utf8) || encoded == Data("[false]".utf8)
    }

    private static func invalid() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid bounded operating-goal request.")
    }
}
