import Foundation
import Testing
@testable import XLogCore

@Suite("Canonical data-quality duplicate review")
struct QSODataQualityDuplicateTests {
    @Test func reusesNativeRuleAndExcludesSelfDeletedAndOutOfWindowRecords() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let db = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let current = QSO(call: "W1AW/P", start: now, band: "20m", mode: "CW", frequencyHz: 14_025_000)
        let near = QSO(call: "w1aw/p", start: now.addingTimeInterval(1), band: "20M", mode: "cw", frequencyHz: 14_050_000)
        let boundary = QSO(call: "W1AW/P", start: now.addingTimeInterval(-600), band: "20m", mode: "CW")
        try db.save(near); try db.save(boundary)
        let native = try db.possibleDuplicate(call: current.call, band: current.band, mode: current.mode, around: now)
        try db.save(current)
        for other in [QSO(call: "W1AW", start: now, band: "20m", mode: "CW"),
                      QSO(call: "W1AW/P", start: now, band: "40m", mode: "CW"),
                      QSO(call: "W1AW/P", start: now, band: "20m", mode: "CWR"),
                      QSO(call: "W1AW/P", start: now.addingTimeInterval(600.001), band: "20m", mode: "CW")] { try db.save(other) }
        let deleted = QSO(call: "W1AW/P", start: now, band: "20m", mode: "CW")
        try db.save(deleted); try db.softDelete(deleted)
        let maybe = try db.contactSnapshot(localID: current.id), snapshot = try #require(maybe)
        let original = try db.fetchAll(), revision = try db.currentRevision(), pending = try db.pendingSyncCount(), outbox = try db.outboxCount()
        let report = try db.contactDataQuality(contactID: current.id, expectedRevision: snapshot.revision, reference: nil)
        let review = try #require(report?.duplicateReview)
        #expect(review.status == .complete)
        #expect(review.rule == "nativePossibleDuplicate600SecondsV1")
        #expect(review.windowSeconds == 600)
        #expect(review.candidates.map(\.contactID) == [native?.id, boundary.id].compactMap { $0 })
        let nearSnapshot = try db.contactSnapshot(localID: near.id)
        #expect(review.candidates.first?.contactRevision == nearSnapshot?.revision)
        #expect(report?.findings.contains { $0.field == "Duplicate" } == true)
        #expect(try db.fetchAll() == original)
        #expect(try db.currentRevision() == revision)
        #expect(try db.pendingSyncCount() == pending)
        #expect(try db.outboxCount() == outbox)
    }

    @Test func usesOneLookaheadAndReportsTruncationWithoutInventingTotal() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let db = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        let current = QSO(call: "W1AW", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "CW")
        try db.save(current)
        var others: [QSO] = []
        for index in 1...6 {
            let other = QSO(call: current.call, start: current.start.addingTimeInterval(Double(index)), band: current.band, mode: current.mode)
            try db.save(other); others.append(other)
        }
        let maybe = try db.contactSnapshot(localID: current.id), snapshot = try #require(maybe)
        let truncated = try db.contactDataQuality(contactID: current.id, expectedRevision: snapshot.revision, reference: nil)
        #expect(truncated?.duplicateReview?.status == .truncated)
        #expect(truncated?.duplicateReview?.candidateLimit == 5)
        #expect(truncated?.duplicateReview?.candidates.map(\.contactID) == others.prefix(5).map(\.id))
        try db.softDelete(others[5])
        let complete = try db.contactDataQuality(contactID: current.id, expectedRevision: snapshot.revision, reference: nil)
        #expect(complete?.duplicateReview?.status == .complete)
        #expect(complete?.duplicateReview?.candidates.count == 5)
    }

    @Test func missingInputsAndDeletedContactsRemainUnknownNotUnique() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let db = try LogbookDatabase(url: directory.appendingPathComponent("test.sqlite"))
        let missing = QSO(call: "", band: "", mode: "")
        try db.save(missing)
        let maybe = try db.contactSnapshot(localID: missing.id), snapshot = try #require(maybe)
        let unknown = try db.contactDataQuality(contactID: missing.id, expectedRevision: snapshot.revision, reference: nil)
        #expect(unknown?.duplicateReview?.status == .unknown)
        #expect(unknown?.duplicateReview?.unresolvedRequirements == ["missingCall", "missingBand", "missingMode"])
        #expect(unknown?.duplicateReview?.candidates.isEmpty == true)
        let deleted = QSO(call: "W1AW", band: "20m", mode: "CW")
        try db.save(deleted); try db.softDelete(deleted)
        let maybeDeleted = try db.contactSnapshot(localID: deleted.id), deletedSnapshot = try #require(maybeDeleted)
        let deletedReport = try db.contactDataQuality(contactID: deleted.id, expectedRevision: deletedSnapshot.revision, reference: nil)
        #expect(deletedReport?.duplicateReview?.status == .unknown)
        #expect(deletedReport?.duplicateReview?.unresolvedRequirements == ["deletedContact"])
        let unique = QSO(call: "VK8AA", band: "40m", mode: "CW")
        try db.save(unique)
        let maybeUnique = try db.contactSnapshot(localID: unique.id), uniqueSnapshot = try #require(maybeUnique)
        let noCandidates = try db.contactDataQuality(contactID: unique.id, expectedRevision: uniqueSnapshot.revision, reference: nil)
        #expect(noCandidates?.duplicateReview?.status == .complete)
        #expect(noCandidates?.duplicateReview?.candidates.isEmpty == true)
    }
}
