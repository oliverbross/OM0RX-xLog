import Foundation
import Testing
@testable import XLogCore

@Suite("Frozen LoTW confirmation preview")
struct LoTWConfirmationPreviewTests {
    private let generation = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    private func contact(id: UUID = UUID(), mode: String = "CW", revision: Int64 = 7,
                         received: String = "", extra: [String: String] = [:]) -> LogbookContactSnapshot {
        let date = ISO8601DateFormatter().date(from: "2026-10-15T12:34:56Z")!
        return LogbookContactSnapshot(revision: revision, qso: QSO(id: id, call: "VK8NSB", start: date,
            band: "20m", mode: mode, comment: "retain me", myCall: "OM0RX", qslReceived: "N",
            lotwSent: "Y", lotwReceived: received, extraFields: extra))
    }
    private func record(call: String = "VK8NSB", time: String = "123456", band: String = "20m",
                        mode: String? = nil, group: String? = nil) -> LoTWConfirmationRecord {
        LoTWConfirmationRecord(stationCallsign: "OM0RX", workedCallsign: call, band: band,
            qsoDate: "20261015", timeOn: time, mode: mode, loTWMode: group,
            confirmation: LoTWConfirmationEvidence(status: .confirmed, qslReceivedDate: "20261016",
                receivedQSLTimestamp: "2026-10-16 01:02:03"))
    }
    private func preview(_ records: [LoTWConfirmationRecord], _ contacts: [LogbookContactSnapshot],
                         itemLimit: Int = 10_000, changeLimit: Int = 30_000) throws -> LoTWConfirmationPreview {
        try LoTWConfirmationPreview.make(report: LoTWConfirmationReport(declaredRecordCount: records.count,
            lastQSL: "2026-10-16 01:02:03", hasDeprecatedEOFMarker: false, records: records),
            contacts: contacts, stationCallsign: "OM0RX", expectedGeneration: generation,
            observedGeneration: generation, itemLimit: itemLimit, changeLimit: changeLimit)
    }

    @Test func onlyConfirmationFieldsChangeAndInputsRemainFrozen() throws {
        let local = contact(extra: ["QSLRDATE": "20200101", "COMMENT": "untouched"])
        let result = try preview([record(mode: "CW")], [local])
        let repeated = try preview([record(mode: "CW")], [local])
        #expect(result == repeated)
        #expect(result.changedCount == 1)
        #expect(result.changeCount == 3)
        #expect(result.items[0].fence == LoTWConfirmationPreview.Fence(generation: generation, contactID: local.qso.id, revision: 7))
        #expect(result.items[0].changes.map(\.field) == [.received, .receivedDate, .sourceTimestamp])
        #expect(result.items[0].changes.map(\.proposed) == ["Y", "20261016", "2026-10-16 01:02:03"])
        #expect(local.qso.lotwReceived.isEmpty)
        #expect(local.qso.qslReceived == "N")
        #expect(local.qso.extraFields["QSLRDATE"] == "20200101")
        #expect(local.qso.comment == "retain me")
    }

    @Test func unchangedAndLegitimateUnmatchedRecordsAreCounted() throws {
        let local = contact(received: "Y", extra: ["LOTW_QSLRDATE": "20261016", "APP_LOTW_RXQSL": "2026-10-16 01:02:03"])
        let result = try preview([record(), record(call: "W1AW"), record(time: "123457"), record(band: "40m")], [local])
        #expect(result.unchangedCount == 1)
        #expect(result.unmatchedCount == 3)
        #expect(result.changedCount == 0)
        #expect(result.items.dropFirst().allSatisfy { $0.fence == nil && $0.changes.isEmpty })
    }

    @Test func optionalExactModeDisambiguatesAndGroupDoesNot() throws {
        let cw = contact(), ssb = contact(mode: "SSB")
        let ambiguous = try preview([record(group: "PHONE")], [cw, ssb])
        #expect(ambiguous.ambiguousCount == 1)
        #expect(ambiguous.changeCount == 0)
        #expect(ambiguous.items[0].candidateCount == 2)
        let matched = try preview([record(mode: "ssb")], [cw, ssb])
        #expect(matched.items[0].fence?.contactID == ssb.qso.id)
        #expect(try preview([record(mode: "RTTY")], [cw]).items[0].fence?.contactID == cw.qso.id)
        #expect(try preview([record(mode: "RTTY")], [cw, ssb]).unmatchedCount == 1)
        #expect(try preview([record(mode: "CW")], [cw, contact()]).ambiguousCount == 1)
    }

    @Test func duplicateDownloadedTargetsAreBlockedDeterministically() throws {
        let result = try preview([record(), record()], [contact()])
        #expect(result.ambiguousCount == 2)
        #expect(result.changeCount == 0)
        #expect(result.items.allSatisfy { $0.fence == nil })
    }

    @Test func unconfirmedRowsNeverDowngradeAndVerifiedStatusIsRetained() throws {
        let unconfirmed = LoTWConfirmationRecord(stationCallsign: "OM0RX", workedCallsign: "VK8NSB",
            band: "20m", qsoDate: "20261015", timeOn: "123456", mode: nil, loTWMode: nil,
            confirmation: LoTWConfirmationEvidence(status: .unconfirmed, qslReceivedDate: nil, receivedQSLTimestamp: nil))
        for status in ["", "N", "Y", "V"] {
            let local = contact(received: status, extra: ["LOTW_QSLRDATE": "20261001"])
            let result = try preview([unconfirmed], [local])
            #expect(result.unchangedCount == 1)
            #expect(result.changeCount == 0)
        }
        let verified = try preview([record()], [contact(received: "V")])
        #expect(verified.items[0].changes.map(\.field) == [.receivedDate, .sourceTimestamp])
    }

    @Test func minutePrecisionMatchesWholeMinuteAndSecondsRemainExact() throws {
        var minuteQSO = contact().qso
        minuteQSO.start = ISO8601DateFormatter().date(from: "2026-10-15T12:34:00Z")!
        let minute = LogbookContactSnapshot(revision: 7, qso: minuteQSO)
        #expect(try preview([record(time: "1234")], [minute]).changedCount == 1)
        #expect(try preview([record(time: "1234")], [contact()]).changedCount == 1)
        #expect(try preview([record(time: "1234")], [minute, contact()]).ambiguousCount == 1)
        #expect(try preview([record(time: "123456")], [minute, contact()]).changedCount == 1)
        #expect(try preview([record(time: "123455")], [contact()]).unmatchedCount == 1)
        #expect(try preview([record(time: "1235")], [contact()]).unmatchedCount == 1)
        var deletedQSO = contact().qso; deletedQSO.deletedAt = Date()
        var otherQSO = contact().qso; otherQSO.myCall = "W1AW"
        let deleted = LogbookContactSnapshot(revision: 7, qso: deletedQSO)
        let other = LogbookContactSnapshot(revision: 7, qso: otherQSO)
        #expect(try preview([record()], [deleted, other]).unmatchedCount == 1)
    }

    @Test func identityRevisionAndGenerationFailClosed() throws {
        let local = contact(), result = try preview([record()], [contact()])
        #expect(throws: LoTWConfirmationPreview.Failure.duplicateContactID) { try preview([record()], [local, local]) }
        #expect(throws: LoTWConfirmationPreview.Failure.invalidRevision) { try preview([record()], [contact(revision: -1)]) }
        #expect(throws: LoTWConfirmationPreview.Failure.missingIdentity) { try result.validateFences(observedGeneration: nil, contacts: []) }
        #expect(throws: LoTWConfirmationPreview.Failure.staleGeneration) { try result.validateFences(observedGeneration: UUID(), contacts: []) }
        #expect(throws: LoTWConfirmationPreview.Failure.missingContact) { try result.validateFences(observedGeneration: generation, contacts: []) }
        let frozen = try preview([record()], [local])
        try frozen.validateFences(observedGeneration: generation, contacts: [local])
        #expect(throws: LoTWConfirmationPreview.Failure.staleContact) {
            try frozen.validateFences(observedGeneration: generation, contacts: [contact(id: local.qso.id, revision: 8)])
        }
        #expect(throws: LoTWConfirmationPreview.Failure.staleContact) {
            try frozen.validateFences(observedGeneration: generation, contacts: [local, contact()])
        }
        let report = LoTWConfirmationReport(declaredRecordCount: 0, lastQSL: nil, hasDeprecatedEOFMarker: false, records: [])
        #expect(throws: LoTWConfirmationPreview.Failure.missingIdentity) {
            try LoTWConfirmationPreview.make(report: report, contacts: [], stationCallsign: "OM0RX", expectedGeneration: nil, observedGeneration: generation)
        }
        #expect(throws: LoTWConfirmationPreview.Failure.staleGeneration) {
            try LoTWConfirmationPreview.make(report: report, contacts: [], stationCallsign: "OM0RX", expectedGeneration: UUID(), observedGeneration: generation)
        }
    }

    @Test func limitsRejectWholePreviewWithoutPartialProposals() throws {
        #expect(throws: LoTWConfirmationPreview.Failure.limitExceeded) { try preview([record()], [contact()], itemLimit: 0) }
        #expect(throws: LoTWConfirmationPreview.Failure.limitExceeded) { try preview([record()], [contact()], changeLimit: 2) }
        #expect(try preview([], [], itemLimit: 0, changeLimit: 0).items.isEmpty)
    }
}
