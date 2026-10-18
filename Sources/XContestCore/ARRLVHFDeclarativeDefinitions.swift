import Foundation

public enum ARRLVHFSeason: String, CaseIterable, Codable, Sendable {
    case january
    case june
    case september
}

/// Inactive source-preview definitions for the three ARRL VHF seasonal plugins.
/// Rover location changes, categories, schedules, and digital modes remain
/// activation gates and are intentionally not inferred here.
public enum ARRLVHFDeclarativeDefinitions {
    public static let pinnedComparatorRevision = "7c8b499225a73f7f8f792246881bd7aefc05452f"

    public static func definition(for season: ARRLVHFSeason) throws -> ContestDeclarativeDefinition {
        try draft(for: season).materialized()
    }

    public static func rule(for season: ARRLVHFSeason) throws -> DeclarativeContestRule {
        DeclarativeContestRule(definition: try definition(for: season))
    }

    public static func draft(for season: ARRLVHFSeason) -> ContestDefinitionDraft {
        let grid = ContestExchangeFieldDescriptor(
            id: "grid", label: "4-character grid square", acceptedKinds: [.maidenheadGrid4],
            maximumUTF8Bytes: 4, adifField: .gridSquare)
        let sentGrid = ContestExchangeFieldDescriptor(
            id: grid.id, label: "Sent grid", acceptedKinds: grid.acceptedKinds,
            maximumUTF8Bytes: grid.maximumUTF8Bytes, adifField: .myGridSquare)
        let report = ContestReportDescriptor(format: .none, defaultSent: "", defaultReceived: "",
                                             maximumUTF8Bytes: 0)
        let entry = ContestEntryDescriptor(
            cabrilloFormatterVersion: "arrl-vhf-source-preview-1",
            cabrilloProjectionFormatterVersion: "arrl-vhf-source-preview-1",
            modeProfiles: [
                .init(mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", report: report),
                .init(mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH", report: report),
            ],
            exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                            adifFields: .exchangeStrings, sentFields: [sentGrid], receivedFields: [grid]),
            serial: .init(requirement: .none, allowedScopes: []),
            scorePolicy: .pointsTimesMultipliers)
        let columns: [ContestDeclarativeExportColumn] = [
            .init(source: .frequencyKHz, width: 10, minimumWidth: 4, alignment: .right),
            .init(source: .mode, width: 2), .init(source: .date, width: 10),
            .init(source: .time, width: 4), .init(source: .stationCallsign, width: 13),
            .init(source: .sentField("grid"), width: 6),
            .init(source: .contactedCallsign, width: 13),
            .init(source: .receivedField("grid"), width: 6),
        ]
        return .init(
            id: id(for: season), version: "1.0.0-source-preview", edition: "contest-sw-26.10.11",
            displayName: displayName(for: season) + " Source Preview", cabrilloName: "ARRL-VHF",
            supportedBands: Set(points(for: season).keys), supportedModes: ["CW", "SSB"], entry: entry,
            sourceProvenance: provenance(for: season), dupePolicy: .perBand,
            multiplierPolicy: .maidenheadGrid, gridMultiplier: .init(receivedFieldID: "grid"),
            scoring: .init(defaultPoints: 0, clauses: [], bandPoints: points(for: season)),
            exportPolicy: .operatorArchive,
            exportProjection: .init(formatterVersion: "arrl-vhf-source-preview-1", columns: columns),
            stationEntityRequired: false)
    }

    public static func points(for season: ARRLVHFSeason) -> [String: Int64] {
        let highBandPoints: Int64 = season == .january ? 8 : 4
        var points: [String: Int64]
        switch season {
        case .january:
            points = ["6m": 1, "2m": 1, "1.25m": 2, "70cm": 2, "33cm": 4, "23cm": 4]
        case .june, .september:
            points = ["6m": 1, "2m": 1, "1.25m": 2, "70cm": 2, "33cm": 3, "23cm": 3]
        }
        for band in ["13cm", "9cm", "6cm", "3cm", "1.25cm", "6mm", "4mm", "2.5mm", "2mm", "1mm", "submm"] {
            points[band] = highBandPoints
        }
        return points
    }

    public static func sourceSHA256(for season: ARRLVHFSeason) -> String {
        switch season {
        case .january: return "692e8456947e307c15ae04c8ffe56a38f5f9475c22973a30d80b3879aeecb990"
        case .june: return "dd7d4183aa106125b3223aca6e2479341a8264995ea5b0261357301325573aff"
        case .september: return "571558e52d5de8fa886f9b4ce7e49a9a86d045b495d732da43ada9c6f36f3656"
        }
    }

    private static func id(for season: ARRLVHFSeason) -> String { "arrl-vhf-\(season.rawValue)" }

    private static func displayName(for season: ARRLVHFSeason) -> String {
        switch season {
        case .january: return "ARRL January VHF"
        case .june: return "ARRL June VHF"
        case .september: return "ARRL September VHF"
        }
    }

    private static func provenance(for season: ARRLVHFSeason) -> String {
        let file: String
        switch season {
        case .january: file = "arrl_vhf_jan.py"
        case .june: file = "arrl_vhf_jun.py"
        case .september: file = "arrl_vhf_sep.py"
        }
        return "oliverbross/contest-sw \(pinnedComparatorRevision) not1mm/plugins/\(file) SHA-256 \(sourceSHA256(for: season)); official point table corrects pinned 2300+ versus canonical high-band values executable defect; source-preview operator archive; schedule, category, rover, and digital coverage pending"
    }
}
