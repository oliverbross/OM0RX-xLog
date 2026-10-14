import Foundation
import XCTest
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Opt-in, generated data only. No worker, settings, credentials or network.
/// The rendezvous uses mergeRemoteBatch's existing preservingLocal callback,
/// which runs inside the production database lock; it adds no production hook.
final class RemoteMergeContentionBenchmarkTests: XCTestCase {
    private struct ForegroundMeasurement {
        let readMilliseconds: Double
        let replaceMilliseconds: Double
        let saveMilliseconds: Double
        let contactReadMilliseconds: Double
        let saved: QSO
    }

    private final class Probe: @unchecked Sendable {
        let enteredMerge = DispatchSemaphore(value: 0)
        let foregroundStarted = DispatchSemaphore(value: 0)
        let foregroundFinished = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var events: [String] = []
        private var outcome: Result<ForegroundMeasurement, Error>?

        func record(_ event: String) { lock.lock(); defer { lock.unlock() }; events.append(event) }
        func complete(_ value: Result<ForegroundMeasurement, Error>) {
            lock.lock(); outcome = value; events.append("foreground_complete"); lock.unlock()
            foregroundFinished.signal()
        }
        func snapshot() -> ([String], Result<ForegroundMeasurement, Error>?) {
            lock.lock(); defer { lock.unlock() }; return (events, outcome)
        }
    }

    private func milliseconds(since start: TimeInterval) -> Double {
        (ProcessInfo.processInfo.systemUptime - start) * 1_000
    }

    private func measure(_ phase: String, database: LogbookDatabase, remotes: [QSO],
                         targetID: UUID) throws -> (conflicts: Int, saved: QSO) {
        let probe = Probe()
        // An OS thread, not a cooperative-executor task that blocks its executor.
        DispatchQueue(label: "synthetic-merge-foreground-\(phase)").async {
            guard probe.enteredMerge.wait(timeout: .now() + 300) == .success else {
                probe.complete(.failure(ProbeError.rendezvousTimeout)); return
            }
            do {
                let readStart = ProcessInfo.processInfo.systemUptime
                probe.record("foreground_read_started")
                probe.foregroundStarted.signal()
                let draft = try database.operatorDraft(initial: QSO(call: "", band: "20m", mode: "CW"))
                let readMs = (ProcessInfo.processInfo.systemUptime - readStart) * 1_000
                probe.record("foreground_read_complete")
                var edited = draft.qso
                edited.call = "K2SYN"; edited.comment = "Synthetic foreground \(phase)"
                let replace = OperatorDraftMutation(operationID: UUID(), draftID: draft.qso.id,
                    expectedRevision: draft.revision, action: .replace, qso: edited)
                let replaceStart = ProcessInfo.processInfo.systemUptime
                let changed = try database.applyOperatorDraft(replace,
                    nextDraft: QSO(call: "", band: "20m", mode: "CW"))
                let replaceMs = (ProcessInfo.processInfo.systemUptime - replaceStart) * 1_000
                let save = OperatorDraftMutation(operationID: UUID(), draftID: changed.draft.qso.id,
                    expectedRevision: changed.draft.revision, action: .save)
                let saveStart = ProcessInfo.processInfo.systemUptime
                let receipt = try database.applyOperatorDraft(save,
                    nextDraft: QSO(call: "", band: "20m", mode: "CW"))
                let saveMs = (ProcessInfo.processInfo.systemUptime - saveStart) * 1_000
                guard let saved = receipt.savedQSO else { throw ProbeError.missingReceipt }
                // Lost-ack retry must not produce another contact, even here.
                guard try database.applyOperatorDraft(save,
                    nextDraft: QSO(call: "", band: "20m", mode: "CW")) == receipt else {
                    throw ProbeError.receiptChanged
                }
                let contactStart = ProcessInfo.processInfo.systemUptime
                guard try database.lookup(localID: targetID) != nil else { throw ProbeError.missingContact }
                let contactMs = (ProcessInfo.processInfo.systemUptime - contactStart) * 1_000
                probe.complete(.success(ForegroundMeasurement(readMilliseconds: readMs,
                    replaceMilliseconds: replaceMs, saveMilliseconds: saveMs,
                    contactReadMilliseconds: contactMs, saved: saved)))
            } catch { probe.complete(.failure(error)) }
        }

        var rendezvoused = false
        var foregroundWasIncompleteInsideLock = false
        var rendezvousMs = 0.0
        let mergeStart = ProcessInfo.processInfo.systemUptime
        let conflicts: Int
        do {
            conflicts = try database.mergeRemoteBatch(remotes, preservingLocal: { _ in
                if !rendezvoused {
                    rendezvoused = true
                    let rendezvousStart = ProcessInfo.processInfo.systemUptime
                    probe.record("merge_lock_held")
                    probe.enteredMerge.signal()
                    // Safety timeout only, not a speed requirement. No sleep or
                    // artificially long lock hold contributes to the benchmark.
                    XCTAssertEqual(probe.foregroundStarted.wait(timeout: .now() + 300), .success)
                    foregroundWasIncompleteInsideLock = probe.snapshot().1 == nil
                    probe.record("merge_continues_with_foreground_pending")
                    rendezvousMs = milliseconds(since: rendezvousStart)
                }
                return false
            })
        } catch {
            // Ensure a failed merge never strands the synthetic foreground job.
            probe.enteredMerge.signal()
            _ = probe.foregroundFinished.wait(timeout: .now() + 300)
            throw error
        }
        let mergeMs = milliseconds(since: mergeStart)
        XCTAssertTrue(rendezvoused)
        XCTAssertTrue(foregroundWasIncompleteInsideLock)
        XCTAssertEqual(probe.foregroundFinished.wait(timeout: .now() + 300), .success)
        let (events, result) = probe.snapshot()
        let measured = try XCTUnwrap(result).get()
        let pendingIndex = try XCTUnwrap(events.firstIndex(of: "merge_continues_with_foreground_pending"))
        let completedIndex = try XCTUnwrap(events.firstIndex(of: "foreground_read_complete"))
        XCTAssertLessThan(pendingIndex, completedIndex)
        print(String(format: "SYNTHETIC_MERGE_CONTENTION phase=%@ rows=%d merge_ms=%.3f rendezvous_ms=%.3f foreground_draft_read_ms=%.3f replace_ms=%.3f save_ms=%.3f contact_read_ms=%.3f pending_inside_merge_lock=true conflicts=%d",
            phase, remotes.count, mergeMs, rendezvousMs, measured.readMilliseconds,
            measured.replaceMilliseconds, measured.saveMilliseconds, measured.contactReadMilliseconds, conflicts))
        return (conflicts, measured.saved)
    }

    func testGeneratedFullSnapshotAndChangedSubsetWithForegroundDraft() throws {
        guard ProcessInfo.processInfo.environment["XLOG_MERGE_CONTENTION_BENCHMARK"] == "1" else {
            throw XCTSkip("Opt-in synthetic 68k full-snapshot/foreground contention benchmark")
        }
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-merge-contention-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try LogbookDatabase(url: root.appendingPathComponent("generated.sqlite"))
        defer { db.close() }
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var remotes = (1...68_000).map { index in
            QSO(wavelogID: index, call: "K\(index % 5_000)SYN",
                start: start.addingTimeInterval(Double(index) * 60),
                band: ["20m", "40m", "15m"][index % 3], mode: "CW",
                frequencyHz: 14_025_000, comment: "Synthetic baseline", isDirty: false)
        }
        let seedStart = ProcessInfo.processInfo.systemUptime
        XCTAssertEqual(try db.mergeRemoteBatch(remotes), 0)
        print(String(format: "SYNTHETIC_MERGE_CONTENTION phase=seed rows=68000 merge_ms=%.3f", milliseconds(since: seedStart)))
        let initialRows = try db.fetchAll()
        let byRemoteID = Dictionary(uniqueKeysWithValues: initialRows.map { ($0.wavelogID!, $0) })
        var dirtyEdit = try XCTUnwrap(byRemoteID[1])
        dirtyEdit.comment = "Unsent local edit must survive"
        try db.save(dirtyEdit)
        let retainedDirtyEdit = try XCTUnwrap(db.lookup(localID: dirtyEdit.id))
        let localDeletion = try XCTUnwrap(byRemoteID[2])
        try db.softDelete(localDeletion)
        let retainedDeletion = try XCTUnwrap(db.lookup(localID: localDeletion.id))
        _ = try db.operatorDraft(initial: QSO(call: "", band: "20m", mode: "CW"))

        let unchanged = try measure("unchanged", database: db, remotes: remotes, targetID: dirtyEdit.id)
        XCTAssertEqual(unchanged.conflicts, 0)
        XCTAssertEqual(try db.lookup(localID: dirtyEdit.id), retainedDirtyEdit)
        XCTAssertEqual(try db.lookup(localID: localDeletion.id), retainedDeletion)
        let afterUnchanged = try db.fetchAll()
        let unchangedByID = Dictionary(uniqueKeysWithValues: afterUnchanged.compactMap { value in
            value.wavelogID.map { ($0, value) }
        })
        XCTAssertTrue(unchangedByID.filter { ![1, 2].contains($0.key) }
            == byRemoteID.filter { ![1, 2].contains($0.key) }, "Unchanged clean rows must remain byte-for-value equivalent")

        // Full snapshot retained; only 1% of remote rows are actually changed.
        for index in stride(from: 0, to: remotes.count, by: 100) {
            remotes[index].comment = "Synthetic remote edit"
            remotes[index].qslReceived = "Y"
        }
        let changed = try measure("changed_1pct", database: db, remotes: remotes, targetID: dirtyEdit.id)
        XCTAssertEqual(changed.conflicts, 1)
        XCTAssertEqual(try db.lookup(localID: dirtyEdit.id), retainedDirtyEdit)
        XCTAssertEqual(try db.lookup(localID: localDeletion.id), retainedDeletion)
        XCTAssertEqual(try db.conflicts().count, 1)
        XCTAssertEqual(try db.lookup(localID: unchanged.saved.id), unchanged.saved)
        XCTAssertEqual(try db.lookup(localID: changed.saved.id), changed.saved)
        let allRows = try db.fetchAll()
        XCTAssertEqual(allRows.count, 68_001) // fetchAll excludes the retained local deletion.
        let liveRemoteIDs = Set(1...68_000).subtracting([2])
        XCTAssertTrue(Set(allRows.compactMap(\.wavelogID)) == liveRemoteIDs, "Only the retained local deletion is absent from live rows")
        for remote in remotes where remote.wavelogID != 1 && remote.wavelogID != 2 {
            let localID = try XCTUnwrap(byRemoteID[remote.wavelogID!]?.id)
            let stored = try XCTUnwrap(db.lookup(localID: localID))
            XCTAssertEqual(stored.comment, remote.comment)
            XCTAssertEqual(stored.qslReceived, remote.qslReceived)
            XCTAssertFalse(stored.isDirty)
        }

        // Deletions still use the complete verified-ID set, not since_id.
        let remainingIDs = Set(4...68_000)
        _ = try db.recordRemoteDeletionConflicts(notIn: remainingIDs)
        XCTAssertEqual(try db.removeCleanRemoteRecords(notIn: remainingIDs), 1)
        XCTAssertEqual(try db.lookup(localID: dirtyEdit.id), retainedDirtyEdit)
        XCTAssertEqual(try db.lookup(localID: localDeletion.id), retainedDeletion)
        let removed = try XCTUnwrap(byRemoteID[3])
        XCTAssertNotNil(try db.lookup(localID: removed.id)?.deletedAt)
        XCTAssertFalse(try db.mergeRemote(remotes[2]))
        XCTAssertNil(try db.lookup(localID: removed.id)?.deletedAt)
        XCTAssertTrue(Set(try db.fetchAll().compactMap(\.wavelogID)) == liveRemoteIDs, "All remote identities survive deletion/resurrection checks")
        XCTAssertEqual(try db.pendingSyncCount(), 4) // edit, deletion and two foreground saves.
    }

    private enum ProbeError: Error {
        case rendezvousTimeout, missingReceipt, receiptChanged, missingContact
    }
}
