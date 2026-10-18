import Foundation

/// Inactive K1USN SST operator-archive definition. Scheduling, reference-data
/// selection, and product catalog activation remain separate acceptance gates.
public enum SSTDeclarativeDefinition {
    public static func definition() throws -> ContestDeclarativeDefinition {
        try draft().materialized()
    }

    public static func rule() throws -> DeclarativeContestRule {
        DeclarativeContestRule(definition: try definition())
    }

    public static func draft() -> ContestDefinitionDraft {
        let sent: [ContestExchangeFieldDescriptor] = [
            .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
                  adifField: .myName),
            .init(id: "location", label: "State, province, or DX",
                  acceptedKinds: [.subdivision], maximumUTF8Bytes: 8, adifField: .myState),
        ]
        let received: [ContestExchangeFieldDescriptor] = [
            .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
                  adifField: .name),
            .init(id: "location", label: "State, province, or DX",
                  acceptedKinds: [.subdivision], maximumUTF8Bytes: 8, adifField: .state),
        ]
        let noReport = ContestReportDescriptor(format: .none, defaultSent: "", defaultReceived: "",
                                               maximumUTF8Bytes: 0)
        let entry = ContestEntryDescriptor(
            cabrilloFormatterVersion: "sst-archive-1",
            cabrilloProjectionFormatterVersion: "sst-archive-1",
            modeProfiles: [.init(mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", report: noReport)],
            exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                            adifFields: .exchangeStrings, sentFields: sent, receivedFields: received),
            serial: .init(requirement: .none, allowedScopes: []), scorePolicy: .pointsTimesMultipliers)
        let geography = ContestDeclarativeGeographicMultiplierPolicy(
            locationFieldID: "location", stationLocationFieldID: "location",
            subdivisions: [
                .init(entityADIF: 291, authority: "sst-us-lower48-state", values: usSubdivisionTokens),
                .init(entityADIF: 1, authority: "sst-canadian-province", values: canadianSubdivisionTokens,
                      aliases: ["NL": "NF"]),
            ],
            entityFallback: .init(authority: "dxcc-entity", locationToken: "DX"))
        return ContestDefinitionDraft(
            id: "k1usn-sst", version: "2.0.0-declarative-archive",
            edition: "official-rules-and-faq-2026-10-18", displayName: "K1USN SST Operator Archive Preview",
            cabrilloName: "K1USNSST",
            supportedBands: ["160m", "80m", "40m", "20m", "15m", "10m"], supportedModes: ["CW"],
            entry: entry,
            sourceProvenance: "K1USN SST rules https://www.k1usn.com/sst_rules.html SHA-256 ced93d6c5d5f7db6d99086df2520c7a86116cac7aed616081ce619fbdb173cdf; sponsor FAQ embedded document SHA-256 a967b3c2ce0c96ad7042930d672098df1e90d802d0a1b04fbe2d161117df49cb and Canadian table image SHA-256 36ee41e13cae55ca81e7fbba3f48836b682167a3d859753d1c91553ae8a35920; sponsor-linked N1MM UDC page SHA-256 e2b30e67b3fd8b03a75f9d5b96d33b80105ee9fddf74cc2b62f1436219d7bc76; retrieved 2026-10-18; operator archive only, not sponsor submission; inactive: schedule, pinned DXCC reference, frequency guidance, and results reporting",
            dupePolicy: .perBand, multiplierPolicy: .geographic, geographicMultiplier: geography,
            scoring: .init(defaultPoints: 1, clauses: []), exportPolicy: .operatorArchive,
            exportProjection: .init(formatterVersion: "sst-archive-1", columns: [
                .init(source: .frequencyKHz, width: 5, alignment: .right),
                .init(source: .mode, width: 2), .init(source: .date, width: 10),
                .init(source: .time, width: 4), .init(source: .stationCallsign, width: 13),
                .init(source: .sentField("name"), width: 10),
                .init(source: .sentField("location"), width: 8),
                .init(source: .contactedCallsign, width: 13),
                .init(source: .receivedField("name"), width: 10),
                .init(source: .receivedField("location"), width: 8),
            ]),
            operatorPolicy: .init(signalProfiles: [.init(mode: "CW", signal: .cw)]),
            stationEntityRequired: true)
    }

    /// Sponsor rules define the lower 48 as state multipliers; the sponsor-linked
    /// UDC changelog explicitly added DC as a multiplier in v1.1.4.
    public static let usSubdivisionTokens: Set<String> = [
        "AL", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "ID", "IL", "IN",
        "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE",
        "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
        "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    ]

    /// These are the 14 tokens in the sponsor FAQ's logger table, including its
    /// separate LB row and NF token. They are not a political-province count.
    public static let canadianSubdivisionTokens: Set<String> = [
        "AB", "BC", "LB", "MB", "NB", "NF", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
    ]
}
