import Foundation

public enum CWUniqueCallContestVariant: String, CaseIterable, Codable, Sendable {
    case cwt
    case cwOpen
    case icwcMST
}

/// Inactive declarative definitions for the shared per-band-dupe, unique-call multiplier family.
/// Event windows, categories, frequency constraints, and export remain activation gates.
public enum CWUniqueCallDeclarativeDefinitions {
    public static func archiveDefinition(for variant: CWUniqueCallContestVariant) throws -> ContestDeclarativeDefinition {
        try archiveDraft(for: variant).materialized()
    }

    public static func archiveRule(for variant: CWUniqueCallContestVariant) throws -> DeclarativeContestRule {
        DeclarativeContestRule(definition: try archiveDefinition(for: variant))
    }

    public static func definition(for variant: CWUniqueCallContestVariant) throws -> ContestDeclarativeDefinition {
        try draft(for: variant).materialized()
    }

    public static func rule(for variant: CWUniqueCallContestVariant) throws -> DeclarativeContestRule {
        DeclarativeContestRule(definition: try definition(for: variant))
    }

    public static func draft(for variant: CWUniqueCallContestVariant) -> ContestDefinitionDraft {
        ContestDefinitionDraft(
            id: id(for: variant), version: "1.0.0-declarative-preview", edition: "official-rules-2026-10-18",
            displayName: displayName(for: variant), cabrilloName: cabrilloName(for: variant),
            supportedBands: ["160m", "80m", "40m", "20m", "15m", "10m"], supportedModes: ["CW"],
            entry: entry(for: variant), sourceProvenance: provenance(for: variant),
            dupePolicy: .perBand, multiplierPolicy: .uniqueCallsign,
            scoring: .init(defaultPoints: 1, clauses: []), eligibilityPolicy: .unrestricted,
            exportPolicy: .unsupported, stationEntityRequired: false)
    }

    public static func archiveDraft(for variant: CWUniqueCallContestVariant) -> ContestDefinitionDraft {
        let base = draft(for: variant)
        let formatter = "cw-unique-call-archive-1"
        let baseEntry = base.entry
        let archiveEntry = ContestEntryDescriptor(
            cabrilloFormatterVersion: formatter, cabrilloProjectionFormatterVersion: formatter,
            modeProfiles: baseEntry.modeProfiles, exchange: baseEntry.exchange, serial: baseEntry.serial,
            stationResolvedSerial: baseEntry.stationResolvedSerial, stationFields: baseEntry.stationFields,
            scorePolicy: baseEntry.scorePolicy)
        return ContestDefinitionDraft(
            id: base.id, version: "2.0.0-declarative-archive", edition: base.edition,
            displayName: base.displayName.replacingOccurrences(of: " Preview", with: " Archive Preview"),
            cabrilloName: base.cabrilloName, supportedBands: base.supportedBands,
            supportedModes: base.supportedModes, entry: archiveEntry,
            sourceProvenance: base.sourceProvenance + "; operator archive only, not sponsor submission",
            dupePolicy: base.dupePolicy, multiplierPolicy: base.multiplierPolicy,
            scoring: base.scoring, eligibilityPolicy: base.eligibilityPolicy,
            exportPolicy: .operatorArchive,
            exportProjection: .init(formatterVersion: formatter, columns: archiveColumns(for: variant)),
            stationEntityRequired: base.stationEntityRequired)
    }

    private static func entry(for variant: CWUniqueCallContestVariant) -> ContestEntryDescriptor {
        let report = ContestReportDescriptor(format: .none, defaultSent: "", defaultReceived: "",
                                             maximumUTF8Bytes: 0)
        return ContestEntryDescriptor(
            cabrilloFormatterVersion: "cw-unique-call-preview-1",
            cabrilloProjectionFormatterVersion: "cw-unique-call-preview-1",
            modeProfiles: [.init(mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", report: report)],
            exchange: exchange(for: variant), serial: serial(for: variant),
            scorePolicy: .pointsTimesMultipliers)
    }

    private static func exchange(for variant: CWUniqueCallContestVariant) -> ContestExchangeDescriptor {
        switch variant {
        case .cwt:
            let sent: [ContestExchangeFieldDescriptor] = [
                .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
                      adifField: .myName),
                .init(id: "member-or-location", label: "Member number, CWA, state, province, or DX prefix",
                      acceptedKinds: [.nonnegativeInteger, .locationText], maximumUTF8Bytes: 32),
            ]
            let received: [ContestExchangeFieldDescriptor] = [
                .init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
                      adifField: .name),
                .init(id: "member-or-location", label: "Member number, CWA, state, province, or DX prefix",
                      acceptedKinds: [.nonnegativeInteger, .locationText], maximumUTF8Bytes: 32),
            ]
            return .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                         adifFields: .exchangeStrings, sentFields: sent, receivedFields: received)
        case .cwOpen:
            return serialNameExchange(serialFirst: true)
        case .icwcMST:
            return serialNameExchange(serialFirst: false)
        }
    }

    private static func serialNameExchange(serialFirst: Bool) -> ContestExchangeDescriptor {
        let sentSerial = ContestExchangeFieldDescriptor(
            id: "serial", label: "Serial", acceptedKinds: [.serialNumber], maximumUTF8Bytes: 8,
            adifField: .stx)
        let sentName = ContestExchangeFieldDescriptor(
            id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
            adifField: .myName)
        let receivedSerial = ContestExchangeFieldDescriptor(
            id: "serial", label: "Serial", acceptedKinds: [.serialNumber], maximumUTF8Bytes: 8,
            adifField: .srx)
        let receivedName = ContestExchangeFieldDescriptor(
            id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
            adifField: .name)
        return .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                     adifFields: .exchangeStrings,
                     sentFields: serialFirst ? [sentSerial, sentName] : [sentName, sentSerial],
                     receivedFields: serialFirst ? [receivedSerial, receivedName] : [receivedName, receivedSerial])
    }

    private static func serial(for variant: CWUniqueCallContestVariant) -> ContestSerialDescriptor {
        variant == .cwt
            ? .init(requirement: .none, allowedScopes: [])
            : .init(requirement: .requiredForCommit, allowedScopes: [.session])
    }

    private static func archiveColumns(for variant: CWUniqueCallContestVariant) -> [ContestDeclarativeExportColumn] {
        let leading: [ContestDeclarativeExportColumn] = [
            .init(source: .frequencyKHz, width: 5, alignment: .right),
            .init(source: .mode, width: 2), .init(source: .date, width: 10),
            .init(source: .time, width: 4), .init(source: .stationCallsign, width: 13),
        ]
        let contact = ContestDeclarativeExportColumn(source: .contactedCallsign, width: 13)
        switch variant {
        case .cwt:
            return leading + [
                .init(source: .sentField("name"), width: 10),
                .init(source: .sentField("member-or-location"), width: 20), contact,
                .init(source: .receivedField("name"), width: 10),
                .init(source: .receivedField("member-or-location"), width: 20),
            ]
        case .cwOpen:
            return leading + [
                .init(source: .sentField("serial"), width: 4, alignment: .right),
                .init(source: .sentField("name"), width: 10), contact,
                .init(source: .receivedField("serial"), width: 4, alignment: .right),
                .init(source: .receivedField("name"), width: 10),
            ]
        case .icwcMST:
            return leading + [
                .init(source: .sentField("name"), width: 10),
                .init(source: .sentField("serial"), width: 4, alignment: .right), contact,
                .init(source: .receivedField("name"), width: 10),
                .init(source: .receivedField("serial"), width: 4, alignment: .right),
            ]
        }
    }

    private static func id(for variant: CWUniqueCallContestVariant) -> String {
        switch variant {
        case .cwt: return "cwops-cwt"
        case .cwOpen: return "cwops-open"
        case .icwcMST: return "icwc-mst"
        }
    }

    private static func displayName(for variant: CWUniqueCallContestVariant) -> String {
        switch variant {
        case .cwt: return "CWops Test (CWT) Preview"
        case .cwOpen: return "CW Open Preview"
        case .icwcMST: return "ICWC Medium Speed Test Preview"
        }
    }

    private static func cabrilloName(for variant: CWUniqueCallContestVariant) -> String {
        switch variant {
        case .cwt: return "CW-OPS"
        case .cwOpen: return "CW-OPEN"
        case .icwcMST: return "ICWC-MST"
        }
    }

    private static func provenance(for variant: CWUniqueCallContestVariant) -> String {
        switch variant {
        case .cwt:
            return "Official https://cwops.org/cwops-tests/ SHA-256 d98a97401dee2cf8106efb1756b78875ce900024715b3bebb19ef2919c646056; pinned contest-sw 7c8b499 cwt.py SHA-256 12010bc2f8a4822e45444c996f82993aea952916405de8449a3ca6fe68c9de64; inactive: event windows, categories, conditional exchange, reporting, export"
        case .cwOpen:
            return "Official https://cwops.org/cwops-tests/cw-open/ SHA-256 b73265ece8bc6e6d6e874a108ddf7ec1e2808c3d9fbdffd3b7380cd30629685a; pinned contest-sw 7c8b499 cwo.py SHA-256 e162c7e11759cd97322e2d60257f05e47312d997751c2fb2db2b5751872b3a8e; inactive: sessions, categories, combined score, duplicate retention, export"
        case .icwcMST:
            return "Official https://internationalcwcouncil.org/mst-contest/ SHA-256 c594f23f513853a42c0644fb8243e5d24700b7a381a2611bc2dd44b862fef289; pinned contest-sw 7c8b499 icwc_mst.py SHA-256 4fcf5971b539a3f7634fea21a752d1a5915d8d11f08c14d0a608a62d57ffb8ca; inactive: event windows, categories, regional frequency limits, 7030 kHz QRP running constraint, export"
        }
    }
}
