import Foundation

/// Trusted native spot selection, never an arbitrary renderer QSO replacement.
public struct SpotDraftSelection: Codable, Equatable, Sendable {
    public let call: String
    public let frequencyHz: Int64?
    public let band: String
    public let mode: String
    public let country: String
    public let dxcc: Int?
    public let comment: String
    public let specialTags: [String]
    public let opportunity: OpportunityDraftReference?
    public var cwCallsign: CWCallsignDraftReference? = nil
    public var draftOnly:Bool {opportunity != nil || cwCallsign != nil}

    public struct CWCallsignDraftReference:Codable,Equatable,Sendable {
        public let sessionID:UUID
        public let sourceID:UUID
        public let streamToken:UUID
        public let epoch:String
        public let trackID:UUID
        public let revision:String
        public let selectionID:UUID
    }

    public struct OpportunityDraftReference: Codable, Equatable, Sendable {
        public let kind: String
        public let reference: String
        public let referenceKind: String
    }

    public func validate() throws {
        let normalized = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard (2...32).contains(normalized.utf8.count),
              normalized.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 47 || $0 == 45 }),
              frequencyHz.map({ (1...1_000_000_000_000).contains($0) }) ?? draftOnly,
              (draftOnly ? (0...16) : (1...16)).contains(band.utf8.count),
              (draftOnly ? (0...16) : (1...16)).contains(mode.utf8.count),
              country.utf8.count <= 256, dxcc.map({ (1...1_000).contains($0) }) ?? true,
              comment.utf8.count <= 8_192, specialTags.count <= 32,
              specialTags.allSatisfy({ $0.utf8.count <= 128 }) else { throw SpotDraftError.invalid }
        if let opportunity {
            guard ["pota", "sota", "wwff", "wwbota", "iota", "castle", "dxpedition", "special_event"].contains(opportunity.kind),
                  opportunity.reference.utf8.count <= 128,
                  ["pota", "sota", "wwff", "wwbota", "iota", "castle", "dxpedition", "special_event"].contains(opportunity.referenceKind)
            else { throw SpotDraftError.invalid }
        }
        if let cwCallsign {
            guard (3...20).contains(normalized.utf8.count),normalized.utf8.contains(where:{(65...90).contains($0)}),
                  normalized.utf8.contains(where:{(48...57).contains($0)}),!normalized.contains("-"),
                  !normalized.hasPrefix("/"),!normalized.hasSuffix("/"),!normalized.contains("//"),
                  opportunity==nil,frequencyHz==nil,band.isEmpty,mode.isEmpty,country.isEmpty,dxcc==nil,
                  comment.isEmpty,specialTags.isEmpty,
                  UInt64(cwCallsign.epoch).map({String($0)})==cwCallsign.epoch,
                  UInt64(cwCallsign.revision).map({String($0)})==cwCallsign.revision,
                  [cwCallsign.sessionID,cwCallsign.sourceID,cwCallsign.streamToken,cwCallsign.trackID,cwCallsign.selectionID]
                    .allSatisfy({$0.uuidString != "00000000-0000-0000-0000-000000000000"}) else {throw SpotDraftError.invalid}
        }
    }

    func applying(to previous: QSO) -> QSO {
        var qso = previous
        if previous.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            != call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
            qso.name = ""; qso.gridSquare = ""; qso.continent = ""; qso.cqZone = ""; qso.ituZone = ""
            qso.state = ""; qso.county = ""; qso.qth = ""; qso.email = ""
        }
        qso.call = call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if cwCallsign != nil {
            if previous.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() != qso.call {
                qso.country="";qso.dxcc=nil
            }
            // Callsign loading preserves operating fields and operator text.
            // The database's existing start-time and power owners still apply.
            return qso
        }
        qso.frequencyHz = frequencyHz
        qso.band = opportunity != nil ? frequencyHz.map(BandPlan.band(for:)) ?? previous.band : band.lowercased()
        qso.mode = opportunity != nil && mode.isEmpty ? previous.mode : mode.uppercased()
        qso.applyDefaultSignalReportsForMode()
        qso.country = country; qso.dxcc = dxcc; qso.comment = comment
        // A spot's references replace the previous selection even for the same
        // call. Reuse the local parser; no asynchronous enrichment can overwrite
        // input after the reservation is released.
        let refs = AwardReferenceParser.extract(comment: comment, specialTags: specialTags)
        qso.potaReference = refs.pota; qso.sotaReference = refs.sota
        qso.iota = refs.iota; qso.wwffReference = refs.wwff
        qso.sig = refs.sig; qso.sigInfo = refs.sigInfo
        if let opportunity {
            qso.potaReference = opportunity.kind == "pota" ? opportunity.reference : ""
            qso.sotaReference = opportunity.kind == "sota" ? opportunity.reference : ""
            qso.iota = opportunity.kind == "iota" || opportunity.referenceKind == "iota" ? opportunity.reference : ""
            qso.wwffReference = opportunity.kind == "wwff" ? opportunity.reference : ""
            qso.sig = ["castle", "wwbota"].contains(opportunity.kind) ? opportunity.kind.uppercased() : ""
            qso.sigInfo = qso.sig.isEmpty ? "" : opportunity.reference
            return qso
        }
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

    /// Proof of the original callsign-only draft commit, never fresh RF authority.
    public func validateCWReceipt(operationID: UUID, generation: UUID) throws {
        try command.validate();try receipt.draft.validate()
        let zero=UUID(uuid:(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0))
        guard [operationID,generation,command.draftID,leaseID].allSatisfy({$0 != zero}),
              command.operationID==operationID,receipt.operationID==operationID,
              command.generation==generation,receipt.generation==generation,
              command.spot.cwCallsign != nil,receipt.phase == .draft_applied,
              receipt.draft.qso.id==command.draftID,receipt.draft.revision==command.expectedRevision+1,
              receipt.draft.qso.call==command.spot.call.trimmingCharacters(in:.whitespacesAndNewlines).uppercased(),
              [.draft_applied,.confirmed,.failed,.uncertain].contains(phase) else {throw SpotDraftError.invalid}
    }
}

public struct SpotDraftApplyResult: Sendable {
    public let record: SpotDraftRecord
    public let replay: Bool
    public let leaseID: UUID?
}

public enum SpotDraftError: Error {
    case invalid, operationReused, busy, staleLease, invalidTransition, abandoned
}
