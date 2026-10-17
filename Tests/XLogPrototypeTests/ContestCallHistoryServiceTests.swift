import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport

final class ContestCallHistoryServiceTests: XCTestCase {
    func testPreviewExpiryAndCancellationRetainCommittedGeneration() async throws {
        let root = temporaryRoot("expiry")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        let clock = HistoryTestClock(Date(timeIntervalSince1970: 100))
        let service = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {},
            previewTTL: 600, now: { clock.wallNow }, monotonicNow: { clock.monotonicNow })
        let first = await service.previewImport(data: validBytes("K1ABC"), sourceName: "first.txt",
                                                importedAtUTC: clock.wallNow)
        let info = try await service.commitImport(previewID: first.previewID,
            expectedSHA256: first.preview.sha256, confirmAdvisories: false)
        let expiring = await service.previewImport(data: validBytes("N1XYZ"), sourceName: "second.txt",
            importedAtUTC: clock.wallNow, workspaceGeneration: "00000000-0000-0000-0000-000000000001")
        await XCTAssertThrowsErrorAsync(try await service.diagnosticPage(
            previewID: expiring.previewID, expectedSHA256: expiring.preview.sha256,
            workspaceGeneration: "00000000-0000-0000-0000-000000000001", offset: Int.max, limit: 100)) {
                XCTAssertEqual($0 as? ContestCallHistoryServiceError, .invalidPage)
            }
        clock.setWall(Date(timeIntervalSince1970: -10_000))
        clock.advanceMonotonic(601)
        await XCTAssertThrowsErrorAsync(try await service.diagnosticPage(
            previewID: expiring.previewID, expectedSHA256: expiring.preview.sha256,
            workspaceGeneration: "00000000-0000-0000-0000-000000000001", offset: 0, limit: 10)) {
                XCTAssertEqual($0 as? ContestCallHistoryServiceError, .expiredPreview)
            }
        let status = await service.status()
        XCTAssertEqual(status.dataset, info)
        XCTAssertNil(status.pending)

        let cancellable = await service.previewImport(data: validBytes("N1XYZ"), sourceName: "third.txt",
            importedAtUTC: clock.wallNow, workspaceGeneration: "00000000-0000-0000-0000-000000000001")
        let didCancel = try await service.cancelImport(
            previewID: cancellable.previewID, expectedSHA256: cancellable.preview.sha256,
            workspaceGeneration: "00000000-0000-0000-0000-000000000001")
        XCTAssertTrue(didCancel)
        await XCTAssertThrowsErrorAsync(try await service.commitImport(
            previewID: cancellable.previewID, expectedSHA256: cancellable.preview.sha256,
            confirmAdvisories: false,
            expectedWorkspaceGeneration: "00000000-0000-0000-0000-000000000001")) {
                XCTAssertEqual($0 as? ContestCallHistoryServiceError, .unknownPreview)
            }
        let retained = await service.status()
        XCTAssertEqual(retained.dataset, info)
    }
    func testPreviewCommitReopenPreservesLosslessRowsAndDuplicateLookup() async throws {
        let root = temporaryRoot("reopen")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        let service = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let bytes = Data("!!Order!!,Call,Name,X-Unknown\r\nK1ABC,Sam,å\r\n k1abc ,Pat,β\r\nBAD CALL,Retained,γ\r\n".utf8)
        let receipt = await service.previewImport(data: bytes, sourceName: "history.txt",
                                                  importedAtUTC: Date(timeIntervalSince1970: 100))
        XCTAssertTrue(receipt.preview.isCommittable)
        XCTAssertTrue(receipt.preview.requiresAdvisoryConfirmation)
        XCTAssertEqual(receipt.preview.rows.count, 3)
        await XCTAssertThrowsErrorAsync(try await service.commitImport(previewID: receipt.previewID,
            expectedSHA256: receipt.preview.sha256, confirmAdvisories: false)) {
            XCTAssertEqual($0 as? ContestCallHistoryServiceError, .advisoryConfirmationRequired)
        }
        let info = try await service.commitImport(previewID: receipt.previewID,
            expectedSHA256: receipt.preview.sha256, confirmAdvisories: true)
        XCTAssertEqual(info.recordCount, 3)
        XCTAssertEqual(info.indexableRecordCount, 2)
        XCTAssertEqual(info.unindexableRecordCount, 1)
        XCTAssertEqual(info.duplicateCallCount, 1)

        let result = try await service.query(callsign: "K1ABC", context: context("K1ABC"))
        XCTAssertEqual(result.records.map(\.sourceOrdinal), [0, 1])
        let selected = try await service.selectedRecord(recordID: result.records[1].recordID,
                                                        from: result, expectedContext: context("K1ABC"))
        XCTAssertEqual(selected.values, [" k1abc ", "Pat", "β"])

        let reopened = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let reopenedStatus = await reopened.status()
        XCTAssertEqual(reopenedStatus.dataset, info)
        var envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: cache)) as? [String: Any])
        envelope["sha256"] = String(repeating: "0", count: 64)
        try JSONSerialization.data(withJSONObject: envelope).write(to: cache, options: [.atomic])
        let digestCorrupt = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let digestCorruptStatus = await digestCorrupt.status()
        XCTAssertNil(digestCorruptStatus.dataset)
        XCTAssertEqual(digestCorruptStatus.unavailableReason, "invalid_cache")
        let reopenedResult = try await reopened.query(callsign: "k1abc", context: context("k1abc"))
        XCTAssertEqual(reopenedResult.records, result.records)
        XCTAssertEqual(try Data(contentsOf: cache).isEmpty, false)
    }

    func testInvalidReplacementAndDigestMismatchLeaveActiveGenerationAndCacheUnchanged() async throws {
        let root = temporaryRoot("invalid")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        let service = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let first = await service.previewImport(data: validBytes("K1ABC"), sourceName: "first.txt",
                                                importedAtUTC: Date(timeIntervalSince1970: 1))
        let firstInfo = try await service.commitImport(previewID: first.previewID,
            expectedSHA256: first.preview.sha256, confirmAdvisories: false)
        let cacheBefore = try Data(contentsOf: cache)

        let invalid = await service.previewImport(data: Data("!!Order!!,Name\nNobody\n".utf8),
                                                  sourceName: "invalid.txt", importedAtUTC: Date(timeIntervalSince1970: 2))
        await XCTAssertThrowsErrorAsync(try await service.commitImport(previewID: invalid.previewID,
            expectedSHA256: invalid.preview.sha256, confirmAdvisories: true)) {
            XCTAssertEqual($0 as? ContestCallHistoryServiceError, .previewNotCommittable)
        }
        await XCTAssertThrowsErrorAsync(try await service.commitImport(previewID: invalid.previewID,
            expectedSHA256: String(repeating: "0", count: 64), confirmAdvisories: true)) {
            XCTAssertEqual($0 as? ContestCallHistoryServiceError, .digestMismatch)
        }
        let retainedStatus = await service.status()
        XCTAssertEqual(retainedStatus.dataset, firstInfo)
        XCTAssertEqual(try Data(contentsOf: cache), cacheBefore)
    }

    func testAtomicWriterFailureLeavesDiskAndActiveDatasetAtPreviousGeneration() async throws {
        let root = temporaryRoot("writer")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        let initial = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let first = await initial.previewImport(data: validBytes("K1ABC"), sourceName: "first.txt",
                                                importedAtUTC: Date(timeIntervalSince1970: 1))
        let firstInfo = try await initial.commitImport(previewID: first.previewID,
            expectedSHA256: first.preview.sha256, confirmAdvisories: false)
        let oldBytes = try Data(contentsOf: cache)

        let failing = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {},
            writeAtomically: { _, _ in throw NSError(domain: "fixture", code: 17) })
        let second = await failing.previewImport(data: validBytes("N1XYZ"), sourceName: "second.txt",
                                                 importedAtUTC: Date(timeIntervalSince1970: 2))
        await XCTAssertThrowsErrorAsync(try await failing.commitImport(previewID: second.previewID,
            expectedSHA256: second.preview.sha256, confirmAdvisories: false))
        let failedStatus = await failing.status()
        XCTAssertEqual(failedStatus.dataset, firstInfo)
        XCTAssertEqual(try Data(contentsOf: cache), oldBytes)
        let reopened = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let reopenedStatus = await reopened.status()
        XCTAssertEqual(reopenedStatus.dataset, firstInfo)
    }

    func testCorruptEnvelopeIsUnavailableAndValidCommitRecovers() async throws {
        let root = temporaryRoot("corrupt")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        try FileManager.default.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("corrupt".utf8).write(to: cache)
        let service = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let corruptStatus = await service.status()
        XCTAssertNil(corruptStatus.dataset)
        XCTAssertEqual(corruptStatus.unavailableReason, "invalid_cache")
        let receipt = await service.previewImport(data: validBytes("K1ABC"), sourceName: "recovered.txt",
                                                  importedAtUTC: Date(timeIntervalSince1970: 3))
        let info = try await service.commitImport(previewID: receipt.previewID,
            expectedSHA256: receipt.preview.sha256, confirmAdvisories: false)
        XCTAssertEqual(info.recordCount, 1)
        let reopened = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let reopenedStatus = await reopened.status()
        XCTAssertEqual(reopenedStatus.dataset, info)
    }

    func testInvalidEnvelopeReadBoundFailsClosedBeforeArithmetic() async throws {
        let root = temporaryRoot("invalid-bound")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        try FileManager.default.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: cache)
        let service = try ContestCallHistoryService(
            cacheURL: cache, validatePrivateRoot: {}, maximumEnvelopeBytes: Int.max)
        let status = await service.status()
        XCTAssertNil(status.dataset)
        XCTAssertEqual(status.unavailableReason, "invalid_cache")
    }

    func testReplacementInvalidatesOldSelectionByDatasetGenerationAndMembership() async throws {
        let root = temporaryRoot("stale")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        let service = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let first = await service.previewImport(data: validBytes("K1ABC"), sourceName: "first.txt",
                                                importedAtUTC: Date(timeIntervalSince1970: 1))
        _ = try await service.commitImport(previewID: first.previewID,
            expectedSHA256: first.preview.sha256, confirmAdvisories: false)
        let oldContext = context("K1ABC")
        let oldResult = try await service.query(callsign: "K1ABC", context: oldContext)
        let oldRecord = try XCTUnwrap(oldResult.records.first)

        let second = await service.previewImport(data: validBytes("N1XYZ"), sourceName: "second.txt",
                                                 importedAtUTC: Date(timeIntervalSince1970: 2))
        _ = try await service.commitImport(previewID: second.previewID,
            expectedSHA256: second.preview.sha256, confirmAdvisories: false)
        await XCTAssertThrowsErrorAsync(try await service.selectedRecord(recordID: oldRecord.recordID,
            from: oldResult, expectedContext: oldContext)) {
            XCTAssertEqual($0 as? ContestCallHistoryError, .staleContext)
        }
        let newResult = try await service.query(callsign: "N1XYZ", context: context("N1XYZ"))
        XCTAssertEqual(newResult.records.count, 1)
        await XCTAssertThrowsErrorAsync(try await service.selectedRecord(recordID: oldRecord.recordID,
            from: newResult, expectedContext: context("N1XYZ"))) {
            XCTAssertEqual($0 as? ContestCallHistoryError, .unknownRecord)
        }
    }

    func testNearLimitSlashHeavyUTF8EnvelopeCommitsAndReopensWithinCacheBound() async throws {
        let root = temporaryRoot("near-limit")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        var bytes = Data("!!Order!!,Call\n".utf8)
        let comment = Data(("#" + String(repeating: "\u{ffff}", count: 5_000) + "\n").utf8)
        bytes.reserveCapacity(16_502_221)
        for _ in 0..<1_100 { bytes.append(comment) }
        bytes.append(contentsOf: Data("K1ABC\n".utf8))
        XCTAssertEqual(bytes.count, 16_502_221)
        let defaultEncoded = try JSONEncoder().encode(["sourceBytes": bytes])
        XCTAssertGreaterThan(defaultEncoded.count, 24 * 1_024 * 1_024)

        let service = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let preview = await service.previewImport(data: bytes, sourceName: "large.txt",
                                                  importedAtUTC: Date(timeIntervalSince1970: 5))
        XCTAssertTrue(preview.preview.isCommittable)
        let info = try await service.commitImport(previewID: preview.previewID,
            expectedSHA256: preview.preview.sha256, confirmAdvisories: false)
        let encoded = try Data(contentsOf: cache)
        XCTAssertLessThanOrEqual(encoded.count, 24 * 1_024 * 1_024)
        let reopened = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let reopenedStatus = await reopened.status()
        XCTAssertEqual(reopenedStatus.dataset, info)
        let result = try await reopened.query(callsign: "K1ABC", context: context("K1ABC"))
        XCTAssertEqual(result.records.count, 1)
    }

    func testEnvelopeSizePreflightPreservesPreviousDatasetAndCache() async throws {
        let root = temporaryRoot("envelope-bound")
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = root.appendingPathComponent("CallHistory/current.json")
        let service = try ContestCallHistoryService(
            cacheURL: cache, validatePrivateRoot: {}, maximumEnvelopeBytes: 1_024)
        let first = await service.previewImport(data: validBytes("K1ABC"), sourceName: "first.txt",
                                                importedAtUTC: Date(timeIntervalSince1970: 1))
        let firstInfo = try await service.commitImport(previewID: first.previewID,
            expectedSHA256: first.preview.sha256, confirmAdvisories: false)
        let cacheBefore = try Data(contentsOf: cache)

        let largerBytes = Data(("!!Order!!,Call\n#" + String(repeating: "A", count: 2_000) + "\nN1XYZ\n").utf8)
        let second = await service.previewImport(data: largerBytes, sourceName: "second.txt",
                                                 importedAtUTC: Date(timeIntervalSince1970: 2))
        await XCTAssertThrowsErrorAsync(try await service.commitImport(previewID: second.previewID,
            expectedSHA256: second.preview.sha256, confirmAdvisories: false)) {
            XCTAssertEqual($0 as? ContestCallHistoryServiceError, .envelopeTooLarge)
        }
        let retained = await service.status()
        XCTAssertEqual(retained.dataset, firstInfo)
        XCTAssertEqual(try Data(contentsOf: cache), cacheBefore)
        let reopened = try ContestCallHistoryService(cacheURL: cache, validatePrivateRoot: {})
        let reopenedStatus = await reopened.status()
        XCTAssertEqual(reopenedStatus.dataset, firstInfo)
    }

    private func validBytes(_ call: String) -> Data { Data("!!Order!!,Call,Name\n\(call),Test\n".utf8) }

    private func context(_ inputCallsign: String) -> ContestCallHistorySelectionContext {
        .init(sessionID: "session", workspaceGeneration: "workspace", sessionRevision: 2,
              draftID: "draft", draftRevision: 4, inputCallsign: inputCallsign, requestID: "request",
              ruleIdentity: .init(id: "cq-ww-cw", version: "2026.1", edition: "2026", sourceRevision: "fixture"),
              referenceDataVersion: "cty-fixture")
    }

    private func temporaryRoot(_ suffix: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("xlog-history-\(suffix)-\(UUID().uuidString)")
    }
}

private final class HistoryTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var wall: Date
    private let monotonicBase = ContinuousClock().now
    private var monotonicOffset: TimeInterval = 0
    init(_ value: Date) { wall = value }
    var wallNow: Date {
        lock.lock(); defer { lock.unlock() }
        return wall
    }
    var monotonicNow: ContinuousClock.Instant {
        lock.lock(); defer { lock.unlock() }
        return monotonicBase.advanced(by: .seconds(monotonicOffset))
    }
    func setWall(_ value: Date) {
        lock.lock(); defer { lock.unlock() }
        wall = value
    }
    func advanceMonotonic(_ interval: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        monotonicOffset += interval
    }
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T,
                                          _ handler: (Error) -> Void = { _ in }) async {
    do { _ = try await expression(); XCTFail("Expected error") } catch { handler(error) }
}
