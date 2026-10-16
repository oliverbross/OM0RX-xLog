import Foundation
import Testing
@testable import XLogCore

@Suite("Pure existing-contact update review")
struct LogbookContactUpdateReviewTests {
    private func contact() -> QSO {
        QSO(wavelogID: 42, call: "W1AW", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "CW", frequencyHz: 14_025_000,
            extraFields: ["APP_KEEP": "unchanged", "APP_CHANGE": "old", "APP_CLEAR": "retained", "APP_REMOVE": "", "APP_VENDOR_A.B": "literal"])
    }
    private func inspect(_ base: LogbookContactSnapshot, _ proposed: QSO?) -> LogbookContactUpdateReview.Review {
        LogbookContactUpdateReview.inspect(current: base, contactID: base.qso.id, expectedRevision: base.revision, proposed: proposed)
    }

    @Test func explicitFencesAndProtectedIdentitiesFailWithoutDifferences() {
        let qso = contact(), base = LogbookContactSnapshot(revision: 7, qso: qso)
        func failure(_ current: LogbookContactSnapshot?, _ id: UUID, _ revision: Int64, _ proposed: QSO?) -> LogbookContactUpdateReview.Failure? {
            let review = LogbookContactUpdateReview.inspect(current: current, contactID: id, expectedRevision: revision, proposed: proposed)
            #expect(review.changes.isEmpty)
            #expect(review.diffStatus == .notValidated)
            return review.failure
        }
        #expect(failure(base, qso.id, -1, qso) == .invalidRevision)
        #expect(failure(base, qso.id, 9_007_199_254_740_991, qso) == .invalidRevision)
        #expect(failure(nil, qso.id, 7, qso) == .contactMissing)
        #expect(failure(base, qso.id, 6, qso) == .staleRevision)
        #expect(failure(base, UUID(), 7, qso) == .contactIdentityMismatch)
        #expect(failure(base, qso.id, 7, nil) == .proposedContactMissing)
        var changed = qso; changed.id = UUID()
        #expect(failure(base, qso.id, 7, changed) == .protectedIdentityChanged)
        changed = qso; changed.wavelogID = nil
        #expect(failure(base, qso.id, 7, changed) == .protectedIdentityChanged)
        changed = qso; changed.deletedAt = qso.start
        #expect(failure(base, qso.id, 7, changed) == .proposedDeletion)
        let deleted = LogbookContactSnapshot(revision: 7, qso: changed)
        #expect(failure(deleted, qso.id, 7, qso) == .deletedContact)
    }

    @Test func arbitraryFieldAddChangeClearRemoveAndPreserveRemainDistinct() {
        var qso = contact(); qso.dxcc = 291
        let base = LogbookContactSnapshot(revision: 3, qso: qso)
        var proposed = qso
        proposed.extraFields["APP_ADD"] = "é / \"new\""
        proposed.extraFields["APP_CHANGE"] = "new"
        proposed.extraFields["APP_CLEAR"] = ""
        proposed.extraFields.removeValue(forKey: "APP_REMOVE")
        proposed.extraFields["APP_VENDOR_A.B"] = "not a nested path"
        proposed.dxcc = nil
        let original = proposed, review = inspect(base, proposed)
        #expect(review.failure == nil)
        #expect(review.diffStatus == .complete)
        #expect(proposed == original && base.qso == qso)
        func change(_ path: [String]) -> LogbookContactUpdateReview.Change? { review.changes.first { $0.path == path } }
        #expect(change(["extraFields", "APP_ADD"])?.retained == .absent)
        #expect(change(["extraFields", "APP_CHANGE"])?.retained == .encodedJSON("\"old\""))
        #expect(change(["extraFields", "APP_CHANGE"])?.proposed == .encodedJSON("\"new\""))
        #expect(change(["extraFields", "APP_CLEAR"])?.proposed == .encodedJSON("\"\""))
        #expect(change(["extraFields", "APP_REMOVE"])?.retained == .encodedJSON("\"\""))
        #expect(change(["extraFields", "APP_REMOVE"])?.proposed == .absent)
        #expect(change(["extraFields", "APP_VENDOR_A.B"]) != nil)
        #expect(change(["extraFields", "APP_KEEP"]) == nil)
        #expect(change(["dxcc"])?.retained == .encodedJSON("291"))
        #expect(change(["dxcc"])?.proposed == .absent)
        #expect(review.changes.count == 6)
    }

    @Test func admissionMatchesPreviousImplementationForValidAndInvalidProposals() {
        let qso = contact(), base = LogbookContactSnapshot(revision: 1, qso: qso)
        func previouslyAccepted(_ proposed: QSO?) -> Bool {
            guard base.qso.deletedAt == nil, let proposed, proposed.id == qso.id,
                  proposed.wavelogID == qso.wavelogID, proposed.deletedAt == nil else { return false }
            var validation = proposed; validation.wavelogID = nil
            do { try validation.validateOperatorDraft(forSave: true); return true } catch { return false }
        }
        var variants: [QSO?] = [qso, nil]
        var value = qso; value.name = "Operator edit"; variants.append(value)
        value = qso; value.call = ""; variants.append(value)
        value = qso; value.band = ""; variants.append(value)
        value = qso; value.frequencyHz = 0; variants.append(value)
        value = qso; value.start = Date(timeIntervalSince1970: .nan); variants.append(value)
        value = qso; value.comment = String(repeating: "x", count: 25_000); variants.append(value)
        value = qso; value.id = UUID(); variants.append(value)
        value = qso; value.wavelogID = 43; variants.append(value)
        value = qso; value.deletedAt = qso.start; variants.append(value)
        for proposed in variants {
            #expect((LogbookContactUpdateReview.admissionFailure(current: base, proposed: proposed) == nil) == previouslyAccepted(proposed))
        }
        #expect(inspect(base, variants[3]).failure == .invalidValues)
    }

    @Test func deterministicDiffHasExplicitBoundsAndDoesNotSimulatePersistence() {
        let qso = contact(), base = LogbookContactSnapshot(revision: 1, qso: qso)
        #expect(inspect(base, qso).changes.isEmpty)
        var managedOnly = qso; managedOnly.isDirty.toggle(); managedOnly.updatedAt = qso.start
        #expect(inspect(base, managedOnly).changes.isEmpty)
        var many = qso
        for index in 0..<160 { many.extraFields[String(format: "APP_%03d", index)] = "" }
        let review = inspect(base, many)
        #expect(review.failure == nil)
        #expect(review.diffStatus == .truncated)
        #expect(review.changes.count == LogbookContactUpdateReview.maximumChanges)
        #expect(review == inspect(base, many))
        var largeCurrent = qso; largeCurrent.comment = String(repeating: "x", count: 25_000)
        let largeBase = LogbookContactSnapshot(revision: 1, qso: largeCurrent)
        let unavailable = inspect(largeBase, qso)
        #expect(unavailable.failure == nil)
        #expect(unavailable.diffStatus == .unavailable)
        #expect(unavailable.changes.isEmpty)
    }

    @Test func inspectionDoesNotTouchDatabaseFilesReceiptsOrRecoveryJournal() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("log.sqlite"), db = try LogbookDatabase(url: url)
        let qso = contact(); try db.save(qso)
        let maybe = try db.contactSnapshot(localID: qso.id), base = try #require(maybe)
        let revision = try db.currentRevision(), outbox = try db.outboxCount(), pending = try db.pendingSyncCount()
        let journal = root.appendingPathComponent("contact-recovery.json")
        try Data("existing recovery must remain untouched".utf8).write(to: journal)
        let files = [url, URL(fileURLWithPath: url.path + "-wal"), URL(fileURLWithPath: url.path + "-shm"), journal]
        let before = files.map { try? Data(contentsOf: $0) }
        var proposed = base.qso; proposed.extraFields["APP_ADD"] = "unaccepted"
        for _ in 0..<3 { #expect(inspect(base, proposed).failure == nil) }
        #expect(files.map { try? Data(contentsOf: $0) } == before)
        #expect(try db.contactSnapshot(localID: qso.id) == base)
        #expect(try db.currentRevision() == revision)
        #expect(try db.outboxCount() == outbox)
        #expect(try db.pendingSyncCount() == pending)
        #expect(try db.contactReceipt(operationID: UUID()) == nil)
    }

    @Test func canonicalApplyStillRejectsInvalidUpdatesAndCommitsNoOpWithDurableReceipt() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("log.sqlite"))
        let qso = contact(); try db.save(qso)
        let maybe = try db.contactSnapshot(localID: qso.id), base = try #require(maybe)
        var invalid = base.qso; invalid.frequencyHz = 0
        let rejected = LogbookContactMutation(operationID: UUID(), contactID: qso.id, expectedRevision: base.revision, action: .update, qso: invalid)
        do { _ = try db.applyContactMutation(rejected); Issue.record("Invalid update was accepted") }
        catch LogbookContactError.invalid { }
        #expect(try db.contactSnapshot(localID: qso.id) == base)
        #expect(try db.contactReceipt(operationID: rejected.operationID) == nil)
        #expect(inspect(base, base.qso).changes.isEmpty)
        let mutation = LogbookContactMutation(operationID: UUID(), contactID: qso.id, expectedRevision: base.revision, action: .update, qso: base.qso)
        let receipt = try db.applyContactMutation(mutation)
        #expect(receipt.contact.revision == base.revision + 1)
        #expect(try db.applyContactMutation(mutation) == receipt)
        #expect(receipt.contact.qso.extraFields == base.qso.extraFields)
        #expect(receipt.contact.qso.wavelogID == 42)
    }
}
