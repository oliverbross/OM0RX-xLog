import Foundation

/// Trusted native spot selection, never an arbitrary renderer QSO replacement.
public struct SpotDraftSelection: Codable, Equatable, Sendable {
    public let call: String
    public let frequencyHz: Int64
    public let band: String
    public let mode: String
    public let country: String
    public let dxcc: Int?
    public let comment: String
    public let specialTags: [String]

    public func validate() throws {
        let normalized = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard (2...32).contains(normalized.utf8.count),
              normalized.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 47 || $0 == 45 }),
              (1...1_000_000_000_000).contains(frequencyHz),
              (1...16).contains(band.utf8.count), (1...16).contains(mode.utf8.count),
              country.utf8.count <= 256, dxcc.map({ (1...1_000).contains($0) }) ?? true,
              comment.utf8.count <= 8_192, specialTags.count <= 32,
              specialTags.allSatisfy({ $0.utf8.count <= 128 }) else { throw SpotDraftError.invalid }
    }

    func applying(to previous: QSO) -> QSO {
        var qso = previous
        if previous.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            != call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
            qso.name = ""; qso.gridSquare = ""; qso.continent = ""; qso.cqZone = ""; qso.ituZone = ""
            qso.state = ""; qso.county = ""; qso.qth = ""; qso.email = ""
        }
        qso.call = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        qso.frequencyHz = frequencyHz; qso.band = band.lowercased(); qso.mode = mode.uppercased()
        qso.country = country; qso.dxcc = dxcc; qso.comment = comment
        // A spot's references replace the previous selection even for the same
        // call. Reuse the local parser; no asynchronous enrichment can overwrite
        // input after the reservation is released.
        let refs = AwardReferenceParser.extract(comment: comment, specialTags: specialTags)
        qso.potaReference = refs.pota; qso.sotaReference = refs.sota
        qso.iota = refs.iota; qso.wwffReference = refs.wwff
        qso.sig = refs.sig; qso.sigInfo = refs.sigInfo
        if !refs.sigInfo.isEmpty, ["WCA", "COTA", "CASTLE"].contains(refs.sig) {
            for programme in ["WCA", "COTA", "CASTLE"] {
                for separator in [" ", "-", ":", "/"] where refs.sigInfo.hasPrefix(programme + separator) {
                    qso.sig = programme
                    qso.sigInfo = String(refs.sigInfo.dropFirst(programme.count + separator.count))
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }
        return qso
    }
}

public struct SpotDraftCommand: Codable, Equatable, Sendable {
    public let operationID: UUID
    public let generation: UUID
    public let draftID: UUID
    public let expectedRevision: Int64
    public let spot: SpotDraftSelection

    public func validate() throws {
        guard (0..<OperatorDraftPowerState.maximumRevision).contains(expectedRevision) else { throw SpotDraftError.invalid }
        try spot.validate()
    }
}

public enum SpotDraftPhase: String, Codable, Sendable {
    case draft_applied, tune_started, tune_confirmed, rotor_started, confirmed, failed, uncertain
    public var terminal: Bool { self == .confirmed || self == .failed || self == .uncertain }
    func permits(_ next: Self) -> Bool {
        switch (self, next) {
        case (.draft_applied, .tune_started), (.tune_started, .tune_confirmed),
             (.tune_confirmed, .rotor_started): return true
        default: return false
        }
    }
}

public struct SpotDraftReceipt: Codable, Equatable, Sendable {
    public let operationID: UUID
    public let generation: UUID
    public let draft: OperatorDraftSnapshot
    public let phase: SpotDraftPhase
}

/// Receipt and command are immutable. Only phase advances. Records are never
/// pruned with transient typing receipts; retries are status, not effect permits.
public struct SpotDraftRecord: Codable, Equatable, Sendable {
    public let command: SpotDraftCommand
    public let receipt: SpotDraftReceipt
    public let leaseID: UUID
    public internal(set) var phase: SpotDraftPhase
}

public struct SpotDraftApplyResult: Sendable {
    public let record: SpotDraftRecord
    public let replay: Bool
    public let leaseID: UUID?
}

public enum SpotDraftError: Error {
    case invalid, operationReused, busy, staleLease, invalidTransition, abandoned
}
