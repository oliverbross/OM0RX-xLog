import Foundation
import XCTest
#if canImport(XLogCore)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

/// Companion, not a replacement for the unchanged atomic baseline benchmark.
/// Generated temporary data only; direct database calls, no worker/network.
final class BoundedRemoteMergeContentionBenchmarkTests: XCTestCase {
    private final class Foreground: @unchecked Sendable {
        let start = DispatchSemaphore(value: 0), done = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var readFinished = false
        private var outcome: Result<(Double, Double, Double, QSO), Error>?
        func markRead() { lock.lock(); readFinished = true; lock.unlock() }
        var hasRead: Bool { lock.lock(); defer { lock.unlock() }; return readFinished }
        func finish(_ value: Result<(Double, Double, Double, QSO), Error>) {
            lock.lock(); outcome = value; lock.unlock(); done.signal()
        }
        func result() throws -> (Double, Double, Double, QSO) {
            lock.lock(); defer { lock.unlock() }; return try XCTUnwrap(outcome).get()
        }
    }

    private func measure(_ phase: String, db: LogbookDatabase, remotes: [QSO]) throws -> (Int, QSO) {
        let foreground = Foreground(), run = try db.beginSyncReconciliation()
        defer { db.endSyncReconciliation(run) }
        DispatchQueue(label: "bounded-foreground-\(phase)").async {
            guard foreground.start.wait(timeout: .now() + 300) == .success else {
                foreground.finish(.failure(URLError(.timedOut))); return
            }
            do {
                let started = ProcessInfo.processInfo.systemUptime
                // Record completion inside the real foreground lock, so the
                // next background chunk's event cannot race a caller-side flag.
                let draft = try db.withDatabaseLock {
                    let value = try db.operatorDraft(initial: QSO(call: "", band: "20m", mode: "CW"))
                    foreground.markRead(); return value
                }
                let readMs = (ProcessInfo.processInfo.systemUptime - started) * 1000
                var edited = draft.qso; edited.call = "K2BENCH"; edited.comment = "Bounded foreground \(phase)"
                let replaceStart = ProcessInfo.processInfo.systemUptime
                let changed = try db.applyOperatorDraft(OperatorDraftMutation(operationID: UUID(), draftID: edited.id,
                    expectedRevision: draft.revision, action: .replace, qso: edited),
                    nextDraft: QSO(call: "", band: "20m", mode: "CW"))
                let replaceMs = (ProcessInfo.processInfo.systemUptime - replaceStart) * 1000
                let mutation = OperatorDraftMutation(operationID: UUID(), draftID: edited.id,
                    expectedRevision: changed.draft.revision, action: .save)
                let saveStart = ProcessInfo.processInfo.systemUptime
                let receipt = try db.applyOperatorDraft(mutation, nextDraft: QSO(call: "", band: "20m", mode: "CW"))
                let saveMs = (ProcessInfo.processInfo.systemUptime - saveStart) * 1000
                XCTAssertEqual(try db.applyOperatorDraft(mutation, nextDraft: QSO(call: "", band: "20m", mode: "CW")), receipt)
                foreground.finish(.success((readMs, replaceMs, saveMs, try XCTUnwrap(receipt.savedQSO))))
            } catch { foreground.finish(.failure(error)) }
        }
        let began = ProcessInfo.processInfo.systemUptime
        var conflicts = 0, registeredInsideFirstStep = false, checkedSecondStep = false
        do {
            for offset in stride(from: 0, to: remotes.count, by: 128) {
                conflicts += try db.mergeRemoteSyncStep(remotes[offset..<min(offset + 128, remotes.count)], run: run,
                    preservingLocal: { _ in
                        if offset == 128 && !checkedSecondStep {
                            checkedSecondStep = true
                            XCTAssertTrue(foreground.hasRead, "Registered foreground must finish before chunk two enters")
                        }
                        if !registeredInsideFirstStep {
                            registeredInsideFirstStep = true; foreground.start.signal()
                            // mergeRemote itself is one recursive foreground
                            // entry; the test operation must register a second.
                            XCTAssertTrue(db.syncAdmission.waitForForegroundRegistrations(2, until: Date().addingTimeInterval(300)))
                        }
                        return false
                    })
            }
        } catch {
            foreground.start.signal(); _ = foreground.done.wait(timeout: .now() + 300); throw error
        }
        let mergeMs = (ProcessInfo.processInfo.systemUptime - began) * 1000
        XCTAssertTrue(registeredInsideFirstStep)
        XCTAssertTrue(checkedSecondStep)
        XCTAssertEqual(foreground.done.wait(timeout: .now() + 300), .success)
        let result = try foreground.result()
        print(String(format: "SYNTHETIC_BOUNDED_MERGE_CONTENTION phase=%@ rows=%d merge_ms=%.3f foreground_draft_read_ms=%.3f replace_ms=%.3f save_ms=%.3f registered_inside_first_step=true foreground_before_step2=true conflicts=%d",
            phase, remotes.count, mergeMs, result.0, result.1, result.2, conflicts))
        return (conflicts, result.3)
    }

    func testGeneratedBounded68kMergeWithRegisteredForeground() throws {
        guard ProcessInfo.processInfo.environment["XLOG_BOUNDED_MERGE_BENCHMARK"] == "1" else {
            throw XCTSkip("Opt-in synthetic bounded 68k merge/foreground benchmark")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("bounded-merge-perf-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("generated.sqlite"))
        defer { db.close() }
        var remotes = (1...68_000).map { id in
            QSO(wavelogID: id, call: "K\(id % 5000)SYN",
                start: Date(timeIntervalSince1970: 1_700_000_000).addingTimeInterval(Double(id) * 60),
                band: ["20m", "40m", "15m"][id % 3], mode: "CW", frequencyHz: 14_025_000,
                comment: "Synthetic baseline", isDirty: false)
        }
        let seedStart = ProcessInfo.processInfo.systemUptime, seedRun = try db.beginSyncReconciliation()
        for offset in stride(from: 0, to: remotes.count, by: 128) {
            XCTAssertEqual(try db.mergeRemoteSyncStep(remotes[offset..<min(offset + 128, remotes.count)],
                                                     run: seedRun, preservingLocal: { _ in false }), 0)
        }
        db.endSyncReconciliation(seedRun)
        print(String(format: "SYNTHETIC_BOUNDED_MERGE_CONTENTION phase=seed rows=68000 merge_ms=%.3f", (ProcessInfo.processInfo.systemUptime - seedStart) * 1000))
        var dirty = try XCTUnwrap(db.lookup(localID: remotes[0].id)); dirty.comment = "Unsent local edit"; try db.save(dirty)
        try db.softDelete(try XCTUnwrap(db.lookup(localID: remotes[1].id)))
        let retainedEdit = try db.lookup(localID: dirty.id), retainedDelete = try db.lookup(localID: remotes[1].id)
        let unchanged = try measure("unchanged", db: db, remotes: remotes)
        XCTAssertEqual(unchanged.0, 0)
        for index in stride(from: 0, to: remotes.count, by: 100) { remotes[index].comment = "Synthetic remote edit"; remotes[index].qslReceived = "Y" }
        let changed = try measure("changed_1pct", db: db, remotes: remotes)
        XCTAssertEqual(changed.0, 1)
        XCTAssertEqual(try db.lookup(localID: dirty.id), retainedEdit)
        XCTAssertEqual(try db.lookup(localID: remotes[1].id), retainedDelete)
        XCTAssertEqual(try db.lookup(localID: unchanged.1.id), unchanged.1)
        XCTAssertEqual(try db.lookup(localID: changed.1.id), changed.1)
        let rows = try db.fetchAll()
        XCTAssertEqual(rows.count, 68_001)
        XCTAssertTrue(Set(rows.compactMap(\.wavelogID)) == Set(1...68_000).subtracting([2]))
        XCTAssertEqual(try db.pendingSyncCount(), 4); XCTAssertEqual(try db.conflicts().count, 1)
        for remote in remotes where remote.wavelogID != 1 && remote.wavelogID != 2 {
            let stored = try XCTUnwrap(db.lookup(localID: remote.id))
            XCTAssertEqual(stored.comment, remote.comment); XCTAssertEqual(stored.qslReceived, remote.qslReceived)
            XCTAssertFalse(stored.isDirty)
        }
    }
}
