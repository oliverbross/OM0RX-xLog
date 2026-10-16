import Foundation
import Testing
@testable import XLogCore

@Suite("Read-only QSO data quality")
struct QSODataQualityTests {
    private let updatedAt = Date(timeIntervalSince1970: 1_700_000_000)
    private func qso() -> QSO {
        QSO(call: "PJ2T", start: Date(timeIntervalSince1970: 1_750_000_000), band: "20m", mode: "CW",
            frequencyHz: 14_025_000, country: "Stored manual country", dxcc: 305, txPower: "5", updatedAt: updatedAt)
    }
    private func snapshot(_ value: QSO) -> LogbookContactSnapshot { LogbookContactSnapshot(revision: 7, qso: value) }
    private func power(_ qso: QSO, watts: String = "5.0", date: String = "2023-11-14T22:13:20.000Z") -> QSO {
        var result = qso
        let prefix = OperatorDraftPowerState.provenancePrefix
        result.extraFields = [prefix + "SOURCE": "kpa500_output", prefix + "UNIT": "W", prefix + "WATTS": watts, prefix + "OBSERVED_AT": date]
        return result
    }

    @Test func validatorFindingsReuseExistingRulesAndNeverInventFieldDates() {
        var value = qso(); value.band = "40m"; value.gridSquare = "invalid"
        let original = snapshot(value)
        let report = QSODataQuality.inspect(original)
        let existing = QSOValidator.validate(value)
        let findings = report.findings.filter { $0.kind == .validation }
        #expect(findings.map(\.message) == existing.map(\.message))
        #expect(findings.map(\.severity) == existing.map(\.severity))
        #expect(findings.allSatisfy { $0.retained.source == .storedFieldOriginUnknown && $0.retained.date == nil })
        #expect(report.retainedFields.allSatisfy { $0.date == nil && $0.dateRole == .fieldOriginUnknown })
        #expect(report.recordUpdatedAtNotFieldOrigin == updatedAt)
        #expect(report.contactStart == value.start)
        #expect(report.contactID == value.id && report.contactRevision == 7)
        #expect(report.referenceStatus == .notProvided)
        #expect(original == snapshot(value))
    }

    @Test func referenceComparisonProtectsStoredOverridesAndRetainsUnknownVersionAndDate() throws {
        let value = qso(), resolver = try CTYResolver.bundled()
        let reference = QSODataQuality.Reference(resolver: resolver, source: "bundled")
        let report = QSODataQuality.inspect(snapshot(value), reference: reference)
        let finding = try #require(report.findings.first { $0.kind == .storedDXCCDisagreesWithReference })
        #expect(finding.retained.value == "305")
        #expect(finding.retained.source == .storedFieldOriginUnknown)
        #expect(finding.comparison?.value == "517")
        #expect(finding.comparison?.referenceSource == "bundled")
        #expect(finding.comparison?.referenceVersion == nil && finding.comparison?.date == nil)
        #expect(finding.reviewImpacts == [.dxccDependentViewsAndRules, .exportAndSyncReview])
        #expect(value.dxcc == 305 && value.country == "Stored manual country")
        var outside = value; outside.dxcc = 0
        #expect(QSODataQuality.inspect(snapshot(outside), reference: reference).findings.contains { $0.kind == .storedDXCCDisagreesWithReference && $0.retained.value == "0" })
        let dated = QSODataQuality.inspect(snapshot(value), reference: .init(resolver: resolver, source: "fixture", version: "retained-reference-version", sourceDate: updatedAt))
        #expect(dated.referenceComparison?.referenceVersion == "retained-reference-version")
        #expect(dated.referenceComparison?.date == updatedAt && dated.referenceComparison?.dateRole == .referenceSourceDate)
        #expect(dated.referenceComparison?.date != value.start)
    }

    @Test func powerComparisonKeepsObservationDateSeparateAndManualEditAuthoritative() throws {
        let value = power(qso(), watts: "100")
        let report = QSODataQuality.inspect(snapshot(value))
        let finding = try #require(report.findings.first { $0.kind == .powerEvidenceDisagrees })
        #expect(finding.retained.value == "5" && finding.retained.date == nil)
        #expect(finding.comparison?.value == "100")
        #expect(finding.comparison?.date == updatedAt && finding.comparison?.dateRole == .powerObservedAt)
        #expect(finding.comparison?.rawDate == "2023-11-14T22:13:20.000Z")
        #expect(value.txPower == "5")
        let matching = QSODataQuality.inspect(snapshot(power(qso())))
        #expect(!matching.findings.contains { $0.field == "txPower" })
        #expect(matching.retainedPowerObservation?.dateRole == .powerObservedAt)
        #expect(matching.retainedPowerObservation?.value == "5.0")
        let exact = QSODataQuality.inspect(snapshot(power(qso(), watts: "5.00000000000000000000000000000000001")))
        #expect(exact.findings.contains { $0.kind == .powerEvidenceDisagrees })
    }

    @Test func missingMalformedAndUnknownPowerProvenanceStayUnknown() throws {
        let missing = QSODataQuality.inspect(snapshot(qso()))
        #expect(missing.findings.contains { $0.kind == .powerSourceUnknown && $0.comparison == nil })
        let malformed = QSODataQuality.inspect(snapshot(power(qso(), date: "not-a-date")))
        let finding = try #require(malformed.findings.first { $0.kind == .powerEvidenceIncomplete })
        #expect(finding.comparison?.date == nil && finding.comparison?.rawDate == "not-a-date")
        var unknown = power(qso()); unknown.extraFields[OperatorDraftPowerState.provenancePrefix + "SOURCE"] = "unverified-source"
        #expect(QSODataQuality.inspect(snapshot(unknown)).findings.contains { $0.kind == .powerEvidenceIncomplete })
        var missingSource = power(qso()); missingSource.extraFields.removeValue(forKey: OperatorDraftPowerState.provenancePrefix + "SOURCE")
        let partial = QSODataQuality.inspect(snapshot(missingSource))
        #expect(partial.findings.contains { $0.kind == .powerEvidenceIncomplete })
        #expect(partial.retainedPowerObservation?.referenceSource == nil)
        #expect(partial.retainedPowerObservation?.date == updatedAt)
    }

    @Test func conflictsUseExistingDifferencesAndRejectStaleOrForeignContext() throws {
        let local = qso(); var remote = local; remote.comment = "Remote retained comment"; remote.txPower = "100"
        let conflict = SyncConflict(localQSO: local, remoteQSO: remote, detectedAt: updatedAt)
        let report = QSODataQuality.inspect(snapshot(local), conflict: conflict)
        let findings = report.findings.filter { $0.kind == .retainedConflict }
        #expect(findings.map(\.field) == QSOConflictMerge.differingFields(in: conflict).map(\.key))
        #expect(findings.allSatisfy { $0.retained.date == nil && $0.comparison?.dateRole == .conflictDetectedAt })
        #expect(findings.allSatisfy { $0.comparison?.date == updatedAt })
        var newer = local; newer.comment = "Newer local comment"
        let stale = QSODataQuality.inspect(snapshot(newer), conflict: conflict)
        #expect(!stale.findings.contains { $0.kind == .retainedConflict })
        #expect(stale.findings.contains { $0.kind == .conflictContextDoesNotMatch && $0.comparison == nil })
        #expect(local.comment.isEmpty && remote.comment == "Remote retained comment")
    }
}
