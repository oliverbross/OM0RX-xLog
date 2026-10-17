import Foundation

public enum TenTenSeasonalVariant: String, CaseIterable, Codable, Sendable {
    case winterPhone
    case springCW
    case summerPhone
    case fallCW
}

public enum TenTenDeclarativeDefinitions {
    public static func definition(for variant: TenTenSeasonalVariant) throws -> ContestDeclarativeDefinition {
        try draft(for: variant).materialized()
    }

    public static func rule(for variant: TenTenSeasonalVariant) throws -> DeclarativeContestRule {
        DeclarativeContestRule(definition: try definition(for: variant))
    }

    public static func draft(for variant: TenTenSeasonalVariant) -> ContestDefinitionDraft {
        let phone = variant == .winterPhone || variant == .summerPhone
        let display: String
        switch variant {
        case .winterPhone: display = "10-10 Winter Phone QSO Party"
        case .springCW: display = "10-10 Spring CW QSO Party"
        case .summerPhone: display = "10-10 Summer Phone QSO Party"
        case .fallCW: display = "10-10 Fall CW QSO Party"
        }
        return ContestDefinitionDraft(
            id: "ten-ten-\(variant.rawValue)", version: "1.0.0-declarative-pilot",
            edition: phone ? "2025-rules-2026-schedule" : "2025-newsletter-unscheduled",
            displayName: display, cabrilloName: "10-10", supportedBands: ["10m"],
            supportedModes: phone ? ["SSB", "AM", "FM"] : ["CW"],
            entry: entry(phone: phone), sourceProvenance: provenance(phone: phone),
            dupePolicy: .oncePerContest, multiplierPolicy: .none,
            scoring: .init(defaultPoints: 1, clauses: [
                .init(fieldID: "member-number", comparison: .greaterThan, threshold: 0, points: 2),
            ]), eligibilityPolicy: .unrestricted,
            exportPolicy: .unsupported, stationEntityRequired: false)
    }

    private static func entry(phone: Bool) -> ContestEntryDescriptor {
        let report = ContestReportDescriptor(format: phone ? .phoneRS : .cwRST,
                                             defaultSent: phone ? "59" : "599",
                                             defaultReceived: phone ? "59" : "599",
                                             maximumUTF8Bytes: phone ? 2 : 3)
        let profiles: [ContestModeProfile] = phone
            ? [
                .init(mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH", report: report),
                .init(mode: "AM", adifMode: "AM", cabrilloQSOType: "PH", report: report),
                .init(mode: "FM", adifMode: "FM", cabrilloQSOType: "PH", report: report),
            ]
            : [.init(mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", report: report)]
        let fields: [ContestExchangeFieldDescriptor] = [
            .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
                  adifField: .name),
            .init(id: "member-number", label: "10-10 Number (0 for non-member)",
                  acceptedKinds: [.nonnegativeInteger], maximumUTF8Bytes: 8),
            .init(id: "qth", label: "QTH", acceptedKinds: [.locationText], maximumUTF8Bytes: 32),
        ]
        let sent = fields.enumerated().map { index, field in
            ContestExchangeFieldDescriptor(id: field.id, label: field.label,
                                           acceptedKinds: field.acceptedKinds,
                                           maximumUTF8Bytes: field.maximumUTF8Bytes,
                                           adifField: index == 0 ? .myName : nil)
        }
        return .init(cabrilloFormatterVersion: "ten-ten-declarative-pilot-1",
                     cabrilloProjectionFormatterVersion: "ten-ten-declarative-pilot-1",
                     modeProfiles: profiles,
                     exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                                     adifFields: .exchangeStrings, sentFields: sent, receivedFields: fields),
                     serial: .init(requirement: .none, allowedScopes: []), scorePolicy: .pointsOnly)
    }

    private static func provenance(phone: Bool) -> String {
        let common = "10-10 QSO Party Handbook https://www.ten-ten.org/qso-party-handbook/ SHA-256 5959521401da9a8758f55c83bed72a374e7e20341ced4180000378b906cf7b7b; October 2025 official newsletter https://www.ten-ten.org/wp-content/uploads/2025/01/2025n4-OnLine.pdf SHA-256 aaa5560aa58b831513b0b3efcf66403e17d2c79b7ebd348322d80f7552326d1f; retrieved 2026-10-18"
        if phone {
            return common + "; current rules https://www.ten-ten.org/qso-party-rules SHA-256 54ccb256e0e42d2cf3edaf8d4f419e50f64beba425859bf899dfd766455dc091; 2026 schedule https://www.ten-ten.org/qso-party-schedule/ SHA-256 47b07443c4abc10c43de2ea0efcacec6dfd2d85176838c6e0ef96293ffbca2da"
        }
        return common + "; CW variants are source-compatible definitions and are not asserted to be scheduled in 2026"
    }
}
