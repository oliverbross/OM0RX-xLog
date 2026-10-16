import Foundation
import Testing
@testable import XLogCore

@Suite("Retained online log follow-up")
struct OnlineLogFollowUpTests {
    private let now = Date(timeIntervalSince1970: 1_700_000_100)

    private func receipt(_ contact: LogbookContactSnapshot, revision: Int64? = nil,
                         state: OnlineLogDeliveryState = .delivered,
                         at: Date? = nil, service: OnlineLogService = .qrz) -> OnlineLogDeliveryReceipt {
        OnlineLogDeliveryReceipt(service: service, contactID: contact.qso.id,
            contactRevision: revision ?? contact.revision, payloadSHA256: "retained-hash", state: state,
            attemptID: UUID(), attemptCount: 1, lastAttemptAt: at ?? now.addingTimeInterval(-60),
            nextAttemptAt: nil, remoteID: "123", safeErrorCode: nil)
    }

    private func contact(revision: Int64 = 3) -> LogbookContactSnapshot {
        LogbookContactSnapshot(revision: revision, qso: QSO(call: "VK8NSB", band: "20m", mode: "CW"))
    }

    @Test func uploadAcceptanceNeverCreatesConfirmationOrCredit() {
        let contact = contact()
        let projection = OnlineLogFollowUp(contact: contact, receipts: [receipt(contact)], now: now)
        #expect(projection.uploads[0].state == .delivered)
        #expect(projection.uploads[0].isCurrentRevision)
        #expect(projection.uploads[0].attemptAgeSeconds == 60)
        #expect(projection.uploads[0].acceptanceAgeSeconds == nil)
        #expect(projection.confirmations.allSatisfy { $0.matchAgeSeconds == nil })
        #expect(projection.awardImpact == .noRetainedConfirmation)
        #expect(!projection.sponsorCreditKnown)
        #expect(projection.uploads[1].state == nil)
    }

    @Test func oldAndForeignReceiptsDoNotLabelCurrentRevisionDelivered() {
        let contact = contact()
        let projection = OnlineLogFollowUp(contact: contact, receipts: [
            receipt(contact, revision: 2), receipt(contact, revision: 4), receipt(self.contact()),
        ], now: now)
        #expect(projection.uploads[0].receiptRevision == 2)
        #expect(!projection.uploads[0].isCurrentRevision)
        #expect(projection.awardImpact == .noRetainedConfirmation)
    }

    @Test func currentUncertainReceiptWinsOverOlderSuccessAndFutureClockIsUnknown() {
        let contact = contact()
        let projection = OnlineLogFollowUp(contact: contact, receipts: [
            receipt(contact, revision: 2), receipt(contact, state: .uncertain, at: now.addingTimeInterval(1)),
        ], now: now)
        #expect(projection.uploads[0].state == .uncertain)
        #expect(projection.uploads[0].isCurrentRevision)
        #expect(projection.uploads[0].attemptAgeSeconds == nil)
    }

    @Test func retainedConfirmationDateIsNotMatchAgeOrAwardCredit() {
        var qso = contact().qso
        qso.lotwReceived = "Y"
        qso.extraFields = ["LOTW_QSLRDATE": "20261015", "EQSL_QSL_RCVD": "V", "EQSL_QSLRDATE": "bad-date"]
        let projection = OnlineLogFollowUp(contact: LogbookContactSnapshot(revision: 4, qso: qso), receipts: [], now: now)
        #expect(projection.confirmations[1].receivedStatus == "Y")
        #expect(projection.confirmations[1].receivedDate == "20261015")
        #expect(projection.confirmations[2].receivedDate == "bad-date")
        #expect(projection.confirmations.allSatisfy { $0.matchAgeSeconds == nil })
        #expect(projection.awardImpact == .retainedConfirmationRequiresAwardRules)
        #expect(!projection.sponsorCreditKnown)
        #expect(projection.uploads.allSatisfy { $0.state == nil })
    }

    @Test func deletedContactKeepsEvidenceButHasNoAwardImpact() {
        var qso = contact().qso
        qso.qslReceived = "Y"
        qso.deletedAt = now
        let projection = OnlineLogFollowUp(contact: LogbookContactSnapshot(revision: 4, qso: qso), receipts: [], now: now)
        #expect(projection.confirmations[0].receivedStatus == "Y")
        #expect(projection.awardImpact == .excludedDeletedContact)
        #expect(!projection.sponsorCreditKnown)
    }
}
