import Foundation
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
import XClusterIntegrationCore

/// Selected targets only. This model evaluates supplied snapshots and has no service owners.
enum OperatingGoal: Hashable, Sendable {
    case entitySlot(dxcc: Int, band: String, mode: String)
    case callsign(String)
    case reference(kind: String, reference: String)

    var normalized: Self {
        switch self {
        case let .entitySlot(dxcc, band, mode):
            return .entitySlot(dxcc: dxcc, band: band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                               mode: SpotLogic.normalizedMode(mode))
        case let .callsign(call): return .callsign(Self.clean(call))
        case let .reference(kind, reference): return .reference(kind: Self.clean(kind).lowercased(), reference: Self.clean(reference))
        }
    }

    var id: String {
        switch normalized {
        case let .entitySlot(dxcc, band, mode): return "entity:\(dxcc):\(band):\(mode)"
        case let .callsign(call): return "call:\(call)"
        case let .reference(kind, reference): return "reference:\(kind):\(reference)"
        }
    }

    fileprivate var isValid: Bool {
        switch normalized {
        case let .entitySlot(dxcc, band, mode):
            return dxcc > 0 && SpotLogic.bands.contains(band) && SpotLogic.modes.contains(mode)
        case let .callsign(call):
            return (3...28).contains(call.count) && call.range(of: #"^[A-Z0-9/]+$"#, options: .regularExpression) != nil
                && call.rangeOfCharacter(from: .decimalDigits) != nil && call.rangeOfCharacter(from: .letters) != nil
        case let .reference(kind, reference):
            let parsed = AwardReferenceParser.extract(comment: "\(kind.uppercased()) \(reference)")
            switch kind {
            case "iota": return !reference.isEmpty && parsed.iota == reference
            case "pota": return !reference.isEmpty && parsed.pota == reference
            case "sota": return !reference.isEmpty && parsed.sota == reference
            case "wwff": return !reference.isEmpty && parsed.wwff == reference
            default: return false
            }
        }
    }

    fileprivate static func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
}

struct OperatingGoalContext: Sendable {
    let now: Date
    /// Existing local log station identity. Nil explicitly means all stations.
    let stationProfileID: Int?
    let stationCall: String?
    /// Presentation context only; UTC evidence instants never depend on the machine timezone.
    let timeZone: TimeZone
    let maximumSpotAge: TimeInterval

    init(now: Date, stationProfileID: Int? = nil, stationCall: String? = nil,
         timeZone: TimeZone = TimeZone(secondsFromGMT: 0)!, maximumSpotAge: TimeInterval = 1_800) {
        self.now = now; self.stationProfileID = stationProfileID
        self.stationCall = stationCall.map(OperatingGoal.clean)
        self.timeZone = timeZone; self.maximumSpotAge = maximumSpotAge
    }
}

struct OperatingGoalEvidence: Equatable, Sendable {
    let id: String
    let source: String
    let sourceURL: String
    let callsign: String
    let reference: String
    let band: String
    let mode: String
    let observedAt: Date
    let timeBasis: String
    let expiresAt: Date
    let startsAt: Date?
    let ageSeconds: TimeInterval
    let freshness: String
    let reason: String

    fileprivate var dedupKey: [String] {
        [source, sourceURL, callsign, reference, band, mode, startsAt.map { String($0.timeIntervalSince1970) } ?? ""]
    }
    fileprivate var tieKey: [String] { dedupKey + [id, timeBasis, freshness, reason] }
}

struct OperatingGoalEvaluation: Equatable, Sendable {
    let goal: OperatingGoal
    let workedCount: Int
    let confirmedCount: Int
    /// Sponsor evidence eligibility and credit are unknown: a local QSL or an
    /// aggregate AwardCatalog total cannot prove an individual target's credit.
    let evidenceEligible: Bool?
    let credited: Bool?
    let evidence: [OperatingGoalEvidence]
    let reasons: [String]
    var worked: Bool { workedCount > 0 }
    var confirmed: Bool { confirmedCount > 0 }
}

enum OperatingGoalEvaluator {
    /// No clock reads, fetches, persistence, notification scheduling or station commands.
    /// Order: unmet goals first, then active evidence, scheduled evidence, then stable goal ID.
    static func evaluate(goals: [OperatingGoal], context: OperatingGoalContext, contacts: [QSO],
                         opportunities: [PublicOpportunity], spots: [ClusterSpotObservation] = [],
                         resolver: CTYResolver? = nil) -> [OperatingGoalEvaluation] {
        guard context.now.timeIntervalSince1970.isFinite, context.maximumSpotAge.isFinite,
              context.maximumSpotAge > 0 else { return [] }
        let scoped = contacts.filter {
            $0.deletedAt == nil && $0.start <= context.now
                && (context.stationProfileID == nil || $0.stationProfileID == context.stationProfileID)
                && (context.stationCall == nil || OperatingGoal.clean($0.myCall) == context.stationCall)
        }
        return Set(goals.map(\.normalized)).filter(\.isValid).map { goal in
            let matching = scoped.filter { matches(goal, contact: $0, resolver: resolver) }
            let confirmed = matching.filter {
                // Same confirmation and mode semantics as LocalContactHistory.
                ClusterContact(callsign: $0.call, band: $0.band, mode: $0.mode,
                               paperQSL: $0.qslReceived, lotwQSL: $0.lotwReceived).isConfirmed
            }.count
            var evidence = opportunities.compactMap { opportunity(goal, item: $0, context: context, resolver: resolver) }
            evidence += spots.compactMap { spot(goal, item: $0, context: context) }
            // Newest evidence wins within one source/target/slot; a refresh does not
            // give stale data a new lifetime. Source identity remains inspectable.
            evidence.sort(by: evidenceOrder)
            var seen: Set<[String]> = []
            evidence = evidence.filter { seen.insert($0.dedupKey).inserted }
            return OperatingGoalEvaluation(goal: goal, workedCount: matching.count, confirmedCount: confirmed,
                evidenceEligible: nil, credited: nil, evidence: evidence,
                reasons: [matching.isEmpty ? "Not worked in the selected local station history." : "Worked in the selected local station history.",
                          confirmed > 0 ? "Paper/LoTW confirmation recorded locally." : "No paper/LoTW confirmation recorded locally.",
                          "Sponsor evidence eligibility and target credit have not been assessed."])
        }.sorted {
            if $0.worked != $1.worked { return !$0.worked }
            let left = rank($0.evidence), right = rank($1.evidence)
            return left == right ? $0.goal.id < $1.goal.id : left < right
        }
    }

    private static func rank(_ evidence: [OperatingGoalEvidence]) -> Int {
        evidence.contains { $0.freshness == "active" } ? 0 : evidence.isEmpty ? 2 : 1
    }

    private static func matches(_ goal: OperatingGoal, contact: QSO, resolver: CTYResolver?) -> Bool {
        switch goal {
        case let .callsign(call): return OperatingGoal.clean(contact.call) == call
        case let .entitySlot(dxcc, band, mode):
            return (contact.dxcc ?? resolver?.resolve(contact.call, at: contact.start)?.adif) == dxcc
                && contact.band.lowercased() == band
                && SpotLogic.normalizedMode(contact.submode.isEmpty ? contact.mode : contact.submode) == mode
        case let .reference(kind, reference):
            let value: String
            switch kind {
            case "iota": value = contact.iota
            case "pota": value = contact.potaReference
            case "sota": value = contact.sotaReference
            case "wwff": value = contact.wwffReference
            default: return false
            }
            // Same explicit multi-reference delimiters as opportunityReferenceHistory.
            return value.split(whereSeparator: { $0 == "," || $0 == ";" || $0.isNewline })
                .contains { OperatingGoal.clean(String($0)) == reference }
        }
    }

    private static func opportunity(_ goal: OperatingGoal, item: PublicOpportunity, context: OperatingGoalContext,
                                    resolver: CTYResolver?) -> OperatingGoalEvidence? {
        let calls = Set(([item.callsign] + (item.callsigns ?? [])).map(OperatingGoal.clean))
        let band = item.frequencyHz.map { SpotLogic.band(for: Double($0) / 1_000) } ?? ""
        let mode = SpotLogic.normalizedMode(item.mode)
        switch goal {
        case let .callsign(call): guard calls.contains(call) else { return nil }
        case let .entitySlot(dxcc, wantedBand, wantedMode):
            guard band == wantedBand, mode == wantedMode,
                  resolver?.resolve(item.callsign, at: item.startsAt ?? item.observedAt)?.adif == dxcc else { return nil }
        case let .reference(kind, reference):
            let referenceKind = OpportunityFeedParser.iotaReference(in: item.reference) == OperatingGoal.clean(item.reference) ? "iota" : item.kind.lowercased()
            guard kind == referenceKind, OperatingGoal.clean(item.reference) == reference else { return nil }
        }
        return evidence(id: item.id, source: item.source, url: item.sourceURL, call: item.callsign,
                        reference: item.reference, band: band, mode: mode, observedAt: item.observedAt,
                        expiresAt: min(item.expiresAt, item.endsAt ?? item.expiresAt), startsAt: item.startsAt, context: context)
    }

    private static func spot(_ goal: OperatingGoal, item: ClusterSpotObservation,
                             context: OperatingGoalContext) -> OperatingGoalEvidence? {
        guard item.arrivedAt <= context.now,
              item.reportedAt.map({ $0 <= context.now }) ?? true else { return nil }
        let value = item.classified
        var matchedReference = ""
        switch goal {
        case let .callsign(call): guard OperatingGoal.clean(item.raw.callsign) == call else { return nil }
        case let .entitySlot(dxcc, band, mode):
            guard value.adif == dxcc, value.band.lowercased() == band,
                  SpotLogic.normalizedMode(value.mode) == mode else { return nil }
        case let .reference(kind, reference):
            let refs = AwardReferenceParser.extract(comment: item.raw.comment, specialTags: value.specialTags)
            let found = ["iota": refs.iota, "pota": refs.pota, "sota": refs.sota, "wwff": refs.wwff]
            guard found[kind] == reference else { return nil }
            matchedReference = reference
        }
        // Historical replies retain report age. Receiving them now cannot revive them.
        let observed = min(item.arrivedAt, item.reportedAt ?? item.raw.receivedAt)
        return evidence(id: item.id.uuidString, source: "Cluster: \(item.clusterName) [\(item.clusterID.uuidString)]", url: "",
                        call: item.raw.callsign, reference: matchedReference, band: value.band, mode: value.mode,
                        observedAt: observed, expiresAt: observed.addingTimeInterval(context.maximumSpotAge),
                        startsAt: nil, context: context, timeBasis: item.timeBasis)
    }

    private static func evidence(id: String, source: String, url: String, call: String, reference: String,
                                 band: String, mode: String, observedAt: Date, expiresAt: Date, startsAt: Date?,
                                 context: OperatingGoalContext, timeBasis: String = "publisher_observed_at") -> OperatingGoalEvidence? {
        guard observedAt.timeIntervalSince1970.isFinite, expiresAt.timeIntervalSince1970.isFinite,
              observedAt <= context.now, expiresAt > context.now,
              startsAt.map({ $0.timeIntervalSince1970.isFinite && $0 < expiresAt }) ?? true else { return nil }
        let scheduled = startsAt.map { $0 > context.now } ?? false
        return OperatingGoalEvidence(id: id, source: source, sourceURL: url, callsign: OperatingGoal.clean(call),
            reference: OperatingGoal.clean(reference), band: band.lowercased(), mode: SpotLogic.normalizedMode(mode),
            observedAt: observedAt, timeBasis: timeBasis, expiresAt: expiresAt, startsAt: startsAt,
            ageSeconds: context.now.timeIntervalSince(observedAt), freshness: scheduled ? "scheduled" : "active",
            reason: scheduled ? "Selected goal matches a published future operating window; activity is unverified."
                : "Selected goal matches unexpired source evidence; current activity is unverified.")
    }

    private static func evidenceOrder(_ lhs: OperatingGoalEvidence, _ rhs: OperatingGoalEvidence) -> Bool {
        if lhs.observedAt != rhs.observedAt { return lhs.observedAt > rhs.observedAt }
        if lhs.expiresAt != rhs.expiresAt { return lhs.expiresAt < rhs.expiresAt }
        if lhs.startsAt != rhs.startsAt {
            switch (lhs.startsAt, rhs.startsAt) {
            case (nil, _): return true
            case (_, nil): return false
            case let (left?, right?): return left < right
            }
        }
        return lhs.tieKey.lexicographicallyPrecedes(rhs.tieKey)
    }
}
