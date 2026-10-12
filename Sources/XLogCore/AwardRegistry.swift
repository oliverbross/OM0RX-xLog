import Foundation

public enum AwardResearchStatus: String, Codable, CaseIterable, Sendable {
    case verifiedCore = "verified_core"
    case partial
    case legacy

    public var title: String {
        switch self {
        case .verifiedCore: return "Verified research"
        case .partial: return "Partial research"
        case .legacy: return "Legacy"
        }
    }
}

public enum AwardCatalogueGroup: String, Codable, CaseIterable, Sendable {
    case global
    case europe
    case world
    case specialty

    public var title: String {
        switch self {
        case .global: return "Global"
        case .europe: return "Europe"
        case .world: return "World"
        case .specialty: return "Specialty"
        }
    }
}

public enum AwardDeliveryState: String, CaseIterable, Sendable {
    case implemented
    case trackingOnly
    case blocked
    case historical

    public var title: String {
        switch self {
        case .implemented: return "Live calculation"
        case .trackingOnly: return "Research tracking"
        case .blocked: return "Blocked"
        case .historical: return "Historical"
        }
    }
}

public struct AwardOfficialSource: Codable, Equatable, Sendable {
    public var url: String?
    public var ref: String?
}

public enum AwardJSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: AwardJSONValue])
    case array([AwardJSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: AwardJSONValue].self) { self = .object(value) }
        else { self = .array(try container.decode([AwardJSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public var displayText: String {
        switch self {
        case let .string(value): return value
        case let .number(value): return value.formatted()
        case let .bool(value): return value ? "Yes" : "No"
        case let .array(values): return values.map(\.displayText).joined(separator: " · ")
        case let .object(values):
            return values.sorted { $0.key < $1.key }
                .map { "\($0.key.replacingOccurrences(of: "_", with: " ")): \($0.value.displayText)" }
                .joined(separator: " · ")
        case .null: return "Not specified"
        }
    }
}

public struct AwardProgrammeRecord: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var originalResearchID: String
    public var name: String
    public var sponsor: String
    public var catalogueGroup: AwardCatalogueGroup
    public var recordType: String
    public var researchStatus: AwardResearchStatus
    public var sharedProfileIDs: [String]
    public var checkedOnUTC: String
    public var scopeOrCountingFocus: String
    public var research: [String: AwardJSONValue]
    public var openQuestions: [String]
    public var officialSources: [AwardOfficialSource]

    enum CodingKeys: String, CodingKey {
        case id, name, sponsor, research
        case originalResearchID = "original_research_id"
        case catalogueGroup = "catalogue_group"
        case recordType = "record_type"
        case researchStatus = "research_status"
        case sharedProfileIDs = "shared_profile_ids"
        case checkedOnUTC = "checked_on_utc"
        case scopeOrCountingFocus = "scope_or_counting_focus"
        case openQuestions = "open_questions"
        case officialSources = "official_sources"
    }

    public var shortCode: String {
        let leading = name.split(separator: "—", maxSplits: 1).first.map(String.init) ?? name
        let candidate = leading.trimmingCharacters(in: .whitespacesAndNewlines)
        return candidate.count <= 18 ? candidate : id.split(separator: ".").last.map(String.init)?.uppercased() ?? id
    }
}

public struct AwardResearchRegistry: Codable, Equatable, Sendable {
    public var format: String
    public var schemaVersion: String
    public var researchCheckedOnUTC: String
    public var researchCheckedOnDarwin: String
    public var intendedModes: [String]
    public var implementationState: String
    public var countingPolicy: String
    public var sharedProfiles: [String: AwardJSONValue]
    public var programmes: [AwardProgrammeRecord]

    enum CodingKeys: String, CodingKey {
        case format, programmes
        case schemaVersion = "schema_version"
        case researchCheckedOnUTC = "research_checked_on_utc"
        case researchCheckedOnDarwin = "research_checked_on_darwin"
        case intendedModes = "intended_modes"
        case implementationState = "implementation_state"
        case countingPolicy = "counting_policy"
        case sharedProfiles = "shared_profiles"
    }
}

public struct AwardProgramme: Identifiable, Equatable, Sendable {
    public var record: AwardProgrammeRecord
    public var deliveryState: AwardDeliveryState
    public var deliveryDetail: String
    public var progress: AwardCatalogItem?
    public var id: String { record.id }
}

public enum AwardRegistry {
    private static let implementedIDs: [String: String] = [
        "jarl.ajd": "AJD",
        "jarl.waja": "WAJA",
        "jarl.jcc": "JCC",
        "jarl.jcg": "JCG",
        "jarl.aja": "AJA",
        "jarl.waca": "WACA",
        "jarl.waga": "WAGA",
    ]

    public static func load() throws -> AwardResearchRegistry {
        guard let url = Bundle.module.url(forResource: "ham-award-research-registry", withExtension: "json") else {
            throw AwardCatalogError.missingResource("award research registry")
        }
        do {
            return try JSONDecoder().decode(AwardResearchRegistry.self, from: Data(contentsOf: url))
        } catch {
            throw AwardCatalogError.invalidResource("award research registry: \(error.localizedDescription)")
        }
    }

    public static func programmes(progress: [AwardCatalogItem]) throws -> (items: [AwardProgramme], researchDate: String) {
        let registry = try load()
        let progressByCode = Dictionary(uniqueKeysWithValues: progress.map { ($0.code, $0) })

        var programmes = registry.programmes.map { record -> AwardProgramme in
            if let code = implementedIDs[record.id], let live = progressByCode[code] {
                return AwardProgramme(
                    record: record,
                    deliveryState: .implemented,
                    deliveryDetail: "Versioned native calculator active. Sponsor credit remains separate until imported or verified.",
                    progress: live
                )
            }
            switch record.researchStatus {
            case .verifiedCore:
                return AwardProgramme(
                    record: record,
                    deliveryState: .trackingOnly,
                    deliveryDetail: "Rules are researched, but no production calculator is asserted until the complete rule pack and required reference data pass audit.",
                    progress: nil
                )
            case .partial:
                return AwardProgramme(
                    record: record,
                    deliveryState: .blocked,
                    deliveryDetail: record.openQuestions.first ?? "The sponsor rule or reference-data dependency is incomplete.",
                    progress: nil
                )
            case .legacy:
                return AwardProgramme(
                    record: record,
                    deliveryState: .historical,
                    deliveryDetail: "Retained for discovery and historical log analysis; not presented as a current claim route.",
                    progress: nil
                )
            }
        }

        for code in ["WAPC", "WCSA"] {
            guard let live = progressByCode[code] else { continue }
            let record = AwardProgrammeRecord(
                id: "xlog.\(code.lowercased())",
                originalResearchID: "xlog.\(code.lowercased())",
                name: live.title,
                sponsor: live.programme,
                catalogueGroup: .world,
                recordType: "xlog_native_award_programme",
                researchStatus: .verifiedCore,
                sharedProfileIDs: [],
                checkedOnUTC: registry.researchCheckedOnUTC,
                scopeOrCountingFocus: live.detail,
                research: [
                    "calculation": .string(live.detail),
                    "evidence": .string("Calculated from the confirmation policy implemented by the native xLog rule pack."),
                ],
                openQuestions: ["Final sponsor eligibility and issued credit remain external to the local calculator."],
                officialSources: []
            )
            programmes.append(AwardProgramme(
                record: record,
                deliveryState: .implemented,
                deliveryDetail: "Existing xLog native calculator retained alongside the 190-programme research registry.",
                progress: live
            ))
        }

        return (programmes.sorted { lhs, rhs in
            if lhs.deliveryState == rhs.deliveryState { return lhs.record.name.localizedCaseInsensitiveCompare(rhs.record.name) == .orderedAscending }
            return deliveryOrder(lhs.deliveryState) < deliveryOrder(rhs.deliveryState)
        }, registry.researchCheckedOnUTC)
    }

    private static func deliveryOrder(_ state: AwardDeliveryState) -> Int {
        switch state {
        case .implemented: return 0
        case .trackingOnly: return 1
        case .blocked: return 2
        case .historical: return 3
        }
    }
}
