import Foundation

/// Local record screening only. A candidate is a record to review, never an
/// eligible QSO, an award completion, or sponsor credit. This model has no I/O,
/// clock, configuration, persistence or contact-mutation authority.
public enum QRPDXCCPreflightV1 {
    public static let rulesVersion = "arrl.qrp_dxcc.preflight.v1"
    public static let reviewedOnUTC = "2026-10-16"
    public static let officialSources = [
        "https://www.arrl.org/qrp-dxcc",
        "https://www.arrl.org/files/file/DXCC/QRP_DXCC_App_2024.pdf",
        "https://www.arrl.org/dxcc-rules",
    ]
    // The linked 2024 application specifies this date, despite the landing
    // page's shorter description of historical contacts. UTC, inclusive.
    public static let earliestContact = Date(timeIntervalSince1970: -761_443_200)

    public enum Disposition: String, Codable, Sendable { case candidate, excluded, unknown }

    public enum Reason: String, Codable, Sendable {
        case retainedPowerWithinLimit
        case deletedContact
        case beforeProgrammeStart
        case sixtyMetreBand
        case recordedRelayPropagation
        case recordedPowerAboveFiveWatts
        case storedOutsideDXCC
        case missingTransmitPower
        case unparseableTransmitPower
        case nonPositiveTransmitPower
        case missingDXCC
        case invalidStoredDXCC
        case missingBand
        case missingCallsign
        case invalidContactDate
        case invalidContactRevision
        case duplicateContactSnapshots
        case satelliteTreatmentRequiresReview
        case mobileLandStatusRequiresReview
    }

    /// These remain unresolved even for every candidate. Neither numeric
    /// TX_PWR, KPA500 output provenance, nor ordinary QSL flags resolve them.
    public enum ReviewRequirement: String, Codable, CaseIterable, Sendable {
        case antennaSystemInputPowerMeasurement
        case sponsorEntityValidityAtContactDate
        case applicantSameOwnEntityScope
        case applicantLicenceHolderScope
        case contactedStationLandStatus
        case authorisedAmateurBandAndOperation
        case directHumanInitiatedTwoWayContact
        case relayUseNotEstablished
        case signedApplicantDeclaration
    }

    public struct Contact: Codable, Equatable, Sendable {
        public let contactID: UUID
        public let contactRevision: Int64
        public let storedDXCC: Int?
        public let retainedTransmitPower: String
        public let disposition: Disposition
        public let reasons: [Reason]
    }

    public struct Report: Codable, Equatable, Sendable {
        public let rulesVersion: String
        public let reviewedOnUTC: String
        public let contacts: [Contact]
        /// Distinct stored DXCC values among candidates, not validated entities
        /// or a lower bound on award progress. There is no completion/credit flag.
        public let candidateStoredDXCCs: [Int]
        public let unresolvedRequirements: [ReviewRequirement]
    }

    public static func evaluate(_ snapshots: [LogbookContactSnapshot]) -> Report {
        let counts = snapshots.reduce(into: [UUID: Int]()) { $0[$1.qso.id, default: 0] += 1 }
        let contacts = snapshots.map { screen($0, duplicate: counts[$0.qso.id, default: 0] > 1) }
        return Report(rulesVersion: rulesVersion, reviewedOnUTC: reviewedOnUTC, contacts: contacts,
            candidateStoredDXCCs: Set(contacts.filter { $0.disposition == .candidate }.compactMap(\.storedDXCC)).sorted(),
            unresolvedRequirements: ReviewRequirement.allCases)
    }

    private static func screen(_ snapshot: LogbookContactSnapshot, duplicate: Bool) -> Contact {
        let qso = snapshot.qso
        var exclusions: [Reason] = [], unknowns: [Reason] = []
        if qso.deletedAt != nil { exclusions.append(.deletedContact) }
        if qso.start.timeIntervalSince1970.isFinite {
            if qso.start < earliestContact { exclusions.append(.beforeProgrammeStart) }
        } else { unknowns.append(.invalidContactDate) }
        if snapshot.revision < 0 { unknowns.append(.invalidContactRevision) }
        if duplicate { unknowns.append(.duplicateContactSnapshots) }
        let band = qso.band.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if band == "60m" { exclusions.append(.sixtyMetreBand) }
        else if band.isEmpty { unknowns.append(.missingBand) }
        let propagation = qso.propagationMode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        // Explicit retained ADIF relay designators; an empty or other value
        // never proves a direct, non-relayed contact.
        if ["RPT", "ECH", "IRL"].contains(propagation) { exclusions.append(.recordedRelayPropagation) }
        else if propagation == "SAT" { unknowns.append(.satelliteTreatmentRequiresReview) }
        let call = qso.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if call.isEmpty { unknowns.append(.missingCallsign) }
        // A suffix is a review hint, not proof of the actual platform. In
        // particular, DXCC has an exception for permanently docked exhibits.
        if call.hasSuffix("/MM") || call.hasSuffix("/AM") { unknowns.append(.mobileLandStatusRequiresReview) }
        if let dxcc = qso.dxcc {
            if dxcc == 0 { exclusions.append(.storedOutsideDXCC) }
            else if !(1...1_000).contains(dxcc) { unknowns.append(.invalidStoredDXCC) }
        } else { unknowns.append(.missingDXCC) }
        switch powerScreen(qso.txPower) {
        case .retainedPowerWithinLimit: break
        case .recordedPowerAboveFiveWatts: exclusions.append(.recordedPowerAboveFiveWatts)
        case let reason: unknowns.append(reason)
        }
        let disposition: Disposition = !exclusions.isEmpty ? .excluded : !unknowns.isEmpty ? .unknown : .candidate
        return Contact(contactID: qso.id, contactRevision: snapshot.revision, storedDXCC: qso.dxcc,
            retainedTransmitPower: qso.txPower, disposition: disposition,
            reasons: exclusions + unknowns + (disposition == .candidate ? [.retainedPowerWithinLimit] : []))
    }

    /// Compare the retained decimal exactly. Double would round values just
    /// above 5 W down to 5; units, exponents and non-ASCII digits are unresolved.
    private static func powerScreen(_ retained: String) -> Reason {
        let value = retained.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .missingTransmitPower }
        guard value.utf8.count <= 64 else { return .unparseableTransmitPower }
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2, value != ".",
              parts.allSatisfy({ $0.utf8.allSatisfy { (48...57).contains($0) } }) else { return .unparseableTransmitPower }
        let integer = parts[0].drop(while: { $0 == "0" })
        let fraction = parts.count == 2 ? parts[1] : ""
        let fractionalNonzero = fraction.contains { $0 != "0" }
        if integer.isEmpty && !fractionalNonzero { return .nonPositiveTransmitPower }
        if integer.count > 1 || integer.first.map({ $0 > "5" }) == true
            || integer == "5" && fractionalNonzero { return .recordedPowerAboveFiveWatts }
        return .retainedPowerWithinLimit
    }
}
