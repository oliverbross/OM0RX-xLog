import Foundation
import Testing
@testable import XLogCore

@Suite("QRP DXCC retained-record preflight v1")
struct QRPDXCCPreflightTests {
    private func contact(power: String = "5", dxcc: Int? = 504, band: String = "20m",
                         propagation: String = "", date: Date = QRPDXCCPreflightV1.earliestContact,
                         call: String = "VK8NSB") -> LogbookContactSnapshot {
        LogbookContactSnapshot(revision: 3, qso: QSO(call: call, start: date, band: band, mode: "CW",
            dxcc: dxcc, txPower: power, propagationMode: propagation))
    }

    @Test func candidatesKeepEverySponsorPrerequisiteUnresolvedAndDoNotRequireQSL() {
        let snapshots = [contact(), contact(power: "0.5", dxcc: 339), contact(power: "4.9")]
        let report = QRPDXCCPreflightV1.evaluate(snapshots)
        #expect(report.rulesVersion == "arrl.qrp_dxcc.preflight.v1")
        #expect(report.reviewedOnUTC == "2026-10-16")
        #expect(report.contacts.allSatisfy { $0.disposition == .candidate })
        #expect(report.contacts.allSatisfy { $0.reasons == [.retainedPowerWithinLimit] })
        #expect(report.candidateStoredDXCCs == [339, 504])
        #expect(report.unresolvedRequirements == QRPDXCCPreflightV1.ReviewRequirement.allCases)
        #expect(snapshots.allSatisfy { $0.qso.qslReceived.isEmpty && $0.qso.lotwReceived.isEmpty })
        #expect(QRPDXCCPreflightV1.evaluate(snapshots) == report)
    }

    @Test func cutoffIsInclusiveAndExplicitLocalExclusionsRemainExplained() {
        #expect(ISO8601DateFormatter().string(from: QRPDXCCPreflightV1.earliestContact) == "1945-11-15T00:00:00Z")
        let report = QRPDXCCPreflightV1.evaluate([
            contact(date: QRPDXCCPreflightV1.earliestContact.addingTimeInterval(-1)),
            contact(band: "60m"), contact(propagation: "RPT"), contact(propagation: "ECH"),
            contact(propagation: "IRL"), contact(power: "5.000000000000000000000000000000001"), contact(dxcc: 0),
        ])
        #expect(report.contacts.allSatisfy { $0.disposition == .excluded })
        #expect(report.contacts.map(\.reasons) == [[.beforeProgrammeStart], [.sixtyMetreBand],
            [.recordedRelayPropagation], [.recordedRelayPropagation], [.recordedRelayPropagation],
            [.recordedPowerAboveFiveWatts], [.storedOutsideDXCC]])
        #expect(report.candidateStoredDXCCs.isEmpty)
        #expect(QRPDXCCPreflightV1.evaluate([contact()]).contacts[0].disposition == .candidate)
    }

    @Test(arguments: ["", "unknown", "5 W", "NaN", "Infinity", "-1", "1e0", "５", ".", "1.2.3", String(repeating: "0", count: 65)])
    func unsupportedPowerRemainsUnknown(_ power: String) {
        let row = QRPDXCCPreflightV1.evaluate([contact(power: power)]).contacts[0]
        #expect(row.disposition == .unknown)
        #expect(row.reasons == [power.isEmpty ? .missingTransmitPower : .unparseableTransmitPower])
    }

    @Test func exactPositiveDecimalScreenDoesNotInventMeasurementEvidence() {
        let accepted = ["5", "5.0", "00005.000", " 4.5 ", ".5", "0.0001", "5."]
        #expect(QRPDXCCPreflightV1.evaluate(accepted.map { contact(power: $0) }).contacts.allSatisfy { $0.disposition == .candidate })
        let zeros = QRPDXCCPreflightV1.evaluate([contact(power: "0"), contact(power: "00.000")])
        #expect(zeros.contacts.allSatisfy { $0.disposition == .unknown && $0.reasons == [.nonPositiveTransmitPower] })
        let high = QRPDXCCPreflightV1.evaluate([contact(power: "6"), contact(power: "100"), contact(power: "005.0001")])
        #expect(high.contacts.allSatisfy { $0.disposition == .excluded && $0.reasons == [.recordedPowerAboveFiveWatts] })
    }

    @Test func missingAndAmbiguousRecordsStayUnknownWithoutCallsignOrLocationInference() {
        let report = QRPDXCCPreflightV1.evaluate([
            contact(dxcc: nil), contact(dxcc: -1), contact(band: ""), contact(call: ""),
            contact(propagation: "SAT"), contact(call: "VK8NSB/MM"), contact(call: "VK8NSB/AM"),
            contact(date: Date(timeIntervalSince1970: .nan)),
        ])
        #expect(report.contacts.allSatisfy { $0.disposition == .unknown })
        #expect(report.contacts.map(\.reasons) == [[.missingDXCC], [.invalidStoredDXCC], [.missingBand], [.missingCallsign],
            [.satelliteTreatmentRequiresReview], [.mobileLandStatusRequiresReview], [.mobileLandStatusRequiresReview], [.invalidContactDate]])
        // A plausible stored code is still not a sponsor-validated entity.
        let arbitrary = QRPDXCCPreflightV1.evaluate([contact(dxcc: 999)])
        #expect(arbitrary.unresolvedRequirements.contains(.sponsorEntityValidityAtContactDate))
    }

    @Test func deletedAndDuplicateSnapshotsNeverCreateCandidateProgress() {
        let original = contact()
        var deleted = original.qso
        deleted.deletedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let deletion = QRPDXCCPreflightV1.evaluate([LogbookContactSnapshot(revision: 4, qso: deleted)])
        #expect(deletion.contacts[0].reasons == [.deletedContact])
        var changed = original.qso
        changed.txPower = "100"
        let report = QRPDXCCPreflightV1.evaluate([original, LogbookContactSnapshot(revision: 4, qso: changed)])
        #expect(report.contacts[0].disposition == .unknown)
        #expect(report.contacts[0].reasons == [.duplicateContactSnapshots])
        #expect(report.contacts[1].disposition == .excluded)
        #expect(report.contacts[1].reasons.contains(.duplicateContactSnapshots))
        #expect(report.candidateStoredDXCCs.isEmpty)
        #expect(original.qso.txPower == "5")
        #expect(original.revision == 3)
    }

    @Test func confirmationsPowerProvenanceAndOwnCallNeverGrantSponsorAuthority() {
        let original = contact()
        var qso = original.qso
        qso.qslReceived = "Y"; qso.lotwReceived = "V"
        qso.myCall = "OM0RX"; qso.operatorCall = "OM0RX"
        qso.extraFields = ["MY_DXCC": "504", "EQSL_QSL_RCVD": "Y",
            "APP_OM0RXXLOG_POWER_SOURCE": "kpa500_output", "APP_OM0RXXLOG_POWER_WATTS": "5"]
        let report = QRPDXCCPreflightV1.evaluate([LogbookContactSnapshot(revision: 4, qso: qso)])
        #expect(report.contacts[0].disposition == .candidate)
        #expect(report.unresolvedRequirements.contains(.antennaSystemInputPowerMeasurement))
        #expect(report.unresolvedRequirements.contains(.applicantSameOwnEntityScope))
        #expect(report.unresolvedRequirements.contains(.applicantLicenceHolderScope))
        #expect(report.unresolvedRequirements.contains(.contactedStationLandStatus))
        #expect(report.unresolvedRequirements.contains(.signedApplicantDeclaration))
    }
}
