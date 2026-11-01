import Foundation
import Dispatch
import XCTest
#if canImport(SQLite3)
import SQLite3
#else
import CSQLitePrototype
#endif
#if os(macOS)
@testable import XLogCore
#else
@testable import XLogPortableCore
#endif

final class LogbookAggregateReadTests: XCTestCase {
    private struct Fixture {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        let db: LogbookDatabase
        init() throws { db = try LogbookDatabase(url: root.appendingPathComponent("aggregate.sqlite")) }
        func clean() { db.close(); try? FileManager.default.removeItem(at: root) }
    }

    private func scalar(_ url: URL, _ sql: String) throws -> Int64 {
        var handle: OpaquePointer?
        let path = try XCTUnwrap(LocalFilePath.nativeFileSystemPath(for: LogbookAggregateFileIdentity.canonicalReaderURL(url)))
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX | SQLITE_OPEN_NOFOLLOW, nil) == SQLITE_OK,
              let handle else { sqlite3_close(handle); throw LogbookDatabaseError.open("Fixture read failed") }
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { throw LogbookDatabaseError.corruptRecord }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw LogbookDatabaseError.corruptRecord }
        return sqlite3_column_int64(statement, 0)
    }

    private func seed(_ db: LogbookDatabase, count: Int = 3) throws {
        for index in 0..<count {
            let value = QSO(call: "JA1A\(index)", start: Date(timeIntervalSince1970: 1_730_000_000 + Double(index)),
                            band: index % 2 == 0 ? "20m" : "40m", mode: "CW", dxcc: 339,
                            state: "01", county: "0102", qslReceived: "Y")
            try db.save(value)
        }
    }

    func testReadonlySnapshotsMatchExistingCalculatorsWithoutPublishingCaches() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db)
        let authority = try fixture.db.aggregateReadAuthority()
        let countSQL = "SELECT COUNT(*) FROM xlog_aggregate_cache"
        XCTAssertEqual(try scalar(fixture.db.url, countSQL), 0)
        let statsToken = LogbookAggregateCancellation()
        let stats = try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url, authority: authority,
            request: .current(.statistics), cancellation: statsToken).evaluate(cancellation: statsToken)
        let catalogueToken = LogbookAggregateCancellation()
        let catalogue = try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url, authority: authority,
            request: .current(.catalogue), cancellation: catalogueToken).evaluate(cancellation: catalogueToken)
        XCTAssertFalse(statsToken.hasRegisteredReader)
        XCTAssertFalse(catalogueToken.hasRegisteredReader)
        XCTAssertEqual(try scalar(fixture.db.url, countSQL), 0)
        guard case .statistics(let value) = stats.value, case .catalogue(let catalog) = catalogue.value else {
            return XCTFail("Aggregate result kind changed")
        }
        XCTAssertEqual(value.stats, try fixture.db.stats())
        XCTAssertEqual(value.awards, try fixture.db.awardProgress())
        XCTAssertEqual(value.dxccStatuses, try fixture.db.dxccMapStatuses())
        XCTAssertEqual(catalog, try AwardCatalogEngine.compute(qsos: fixture.db.fetchAll()))
        XCTAssertTrue(try fixture.db.publishAggregateResult(catalogue))
        XCTAssertEqual(try fixture.db.awardCatalog(), catalog)
    }

    func testRevisionAndAllStatsComponentsRemainInOneWALSnapshot() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 1)
        let external = try LogbookDatabase(url: fixture.db.url); defer { external.close() }
        let authority = try fixture.db.aggregateReadAuthority()
        let token = LogbookAggregateCancellation()
        token.afterSnapshotPinned = { try external.save(QSO(call: "K1NEW", band: "80m", mode: "SSB", dxcc: 291)) }
        let result = try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url, authority: authority,
            request: .current(.statistics), cancellation: token).evaluate(cancellation: token)
        guard case .statistics(let value) = result.value else { return XCTFail("Missing statistics") }
        XCTAssertEqual(result.authority, authority)
        XCTAssertEqual(value.stats.qsoCount, 1)
        XCTAssertEqual(value.awards.qsoCount, 1)
        XCTAssertEqual(value.dxccStatuses, [339: "confirmed"])
        XCTAssertEqual(try fixture.db.currentRevision(), authority.revision + 1)
        XCTAssertFalse(try fixture.db.publishAggregateResult(result))
        XCTAssertEqual(try scalar(fixture.db.url, "SELECT COUNT(*) FROM xlog_aggregate_cache"), 0)
    }

    func testObsoleteRevisionIsRejectedBeforeHeavyMaterialization() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 1)
        let authority = try fixture.db.aggregateReadAuthority()
        try seed(fixture.db, count: 1)
        let token = LogbookAggregateCancellation()
        token.afterSnapshotPinned = { XCTFail("Materialized an obsolete revision") }
        XCTAssertThrowsError(try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url, authority: authority,
            request: .current(.catalogue), cancellation: token)) {
            XCTAssertEqual($0 as? LogbookAggregateReadError, .superseded)
        }
        XCTAssertFalse(token.hasRegisteredReader)
    }

    func testMissingAndUnmigratedFilesAreNeverCreatedOrMigrated() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        let authority = try fixture.db.aggregateReadAuthority()
        let missing = fixture.root.appendingPathComponent("absent/never-created.sqlite")
        XCTAssertThrowsError(try LogbookDatabase.readAggregateSnapshot(at: missing, authority: authority,
            request: .current(.statistics), cancellation: LogbookAggregateCancellation()))
        XCTAssertFalse(FileManager.default.fileExists(atPath: missing.deletingLastPathComponent().path))
        let empty = fixture.root.appendingPathComponent("unmigrated.sqlite")
        try Data().write(to: empty)
        let emptyAuthority = LogbookAggregateAuthority(revision: 0, fileIdentity: try .capture(at: empty))
        XCTAssertThrowsError(try LogbookDatabase.readAggregateSnapshot(at: empty, authority: emptyAuthority,
            request: .current(.statistics), cancellation: LogbookAggregateCancellation()))
        XCTAssertEqual(try Data(contentsOf: empty), Data())
    }

    func testReplacementWithTheSameRevisionHasDifferentAuthority() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 1)
        let authority = try fixture.db.aggregateReadAuthority()
        fixture.db.close()
        try FileManager.default.moveItem(at: fixture.db.url, to: fixture.root.appendingPathComponent("retained.sqlite"))
        let replacement = try LogbookDatabase(url: fixture.db.url); defer { replacement.close() }
        try seed(replacement, count: 1)
        XCTAssertEqual(try replacement.currentRevision(), authority.revision)
        XCTAssertThrowsError(try LogbookDatabase.readAggregateSnapshot(at: replacement.url, authority: authority,
            request: .current(.catalogue), cancellation: LogbookAggregateCancellation())) {
            XCTAssertEqual($0 as? LogbookAggregateReadError, .retired)
        }
    }

    func testProvisionalOwnerTransactionCannotAuthorizeOrPublishAndRollbackStaysClean() throws {
        enum Abort: Error { case fixture }
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 1)
        let authority = try fixture.db.aggregateReadAuthority(), token = LogbookAggregateCancellation()
        let result = try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url, authority: authority,
            request: .current(.statistics), cancellation: token).evaluate(cancellation: token)
        XCTAssertThrowsError(try fixture.db.applyConfirmationChanges { _ in
            try fixture.db.save(QSO(call: "UNCOMMITTED", band: "10m", mode: "CW"))
            XCTAssertThrowsError(try fixture.db.aggregateReadAuthority()) {
                guard case LogbookDatabaseError.syncBusy = $0 else { return XCTFail("Accepted provisional authority: \($0)") }
            }
            XCTAssertThrowsError(try fixture.db.publishAggregateResult(result)) {
                guard case LogbookDatabaseError.syncBusy = $0 else { return XCTFail("Published into provisional transaction: \($0)") }
            }
            throw Abort.fixture
        })
        XCTAssertEqual(try fixture.db.aggregateReadAuthority(), authority)
        XCTAssertEqual(try scalar(fixture.db.url, "SELECT COUNT(*) FROM xlog_aggregate_cache"), 0)
        XCTAssertTrue(try fixture.db.publishAggregateResult(result))
        XCTAssertEqual(try fixture.db.stats().qsoCount, 1)
    }

    #if !os(Windows)
    func testArbitraryAncestorSymlinksAreNotPromotedToSystemAliases() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 1)
        let link = fixture.root.appendingPathComponent("not-a-system-alias")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: fixture.root)
        let aliased = link.appendingPathComponent(fixture.db.url.lastPathComponent)
        XCTAssertThrowsError(try LogbookDatabase.readAggregateSnapshot(at: aliased,
            authority: fixture.db.aggregateReadAuthority(), request: .current(.statistics), cancellation: LogbookAggregateCancellation()))
    }

    func testStillOpenPrimaryNeverCombinesItsRevisionWithAReplacementFileIdentity() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 1)
        let authority = try fixture.db.aggregateReadAuthority(), token = LogbookAggregateCancellation()
        let result = try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url, authority: authority,
            request: .current(.statistics), cancellation: token).evaluate(cancellation: token)
        let staged = fixture.root.appendingPathComponent("replacement.sqlite")
        let replacement = try LogbookDatabase(url: staged)
        try replacement.save(QSO(call: "K1REPLACED", band: "80m", mode: "SSB", dxcc: 291))
        XCTAssertEqual(try replacement.currentRevision(), authority.revision)
        replacement.close()
        try FileManager.default.moveItem(at: fixture.db.url, to: fixture.root.appendingPathComponent("old-open.sqlite"))
        try FileManager.default.moveItem(at: staged, to: fixture.db.url)
        XCTAssertThrowsError(try fixture.db.aggregateReadAuthority()) {
            XCTAssertEqual($0 as? LogbookAggregateReadError, .retired)
        }
        XCTAssertThrowsError(try fixture.db.publishAggregateResult(result)) {
            XCTAssertEqual($0 as? LogbookAggregateReadError, .retired)
        }
        fixture.db.close()
        // These sidecars belong to the deliberately renamed old fixture, never
        // to the closed/checkpointed replacement. No live owner remains.
        for suffix in ["-wal", "-shm"] {
            let oldSidecar = URL(fileURLWithPath: fixture.db.url.path + suffix)
            if FileManager.default.fileExists(atPath: oldSidecar.path) { try FileManager.default.removeItem(at: oldSidecar) }
        }
        let reopened = try LogbookDatabase(url: fixture.db.url); defer { reopened.close() }
        XCTAssertEqual(try reopened.fetch().map(\.call), ["K1REPLACED"])
    }
    #endif

    private final class ReadOutcome: @unchecked Sendable {
        let lock = NSLock()
        var stored: Error?
        private var completed = false
        func set(_ error: Error) { lock.withLock { stored = error } }
        var error: Error? { lock.withLock { stored } }
        func finish() { lock.withLock { completed = true } }
        var finished: Bool { lock.withLock { completed } }
    }

    func testInterruptDrainsTheReaderBeforeWindowsCompatibleRename() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 64)
        let authority = try fixture.db.aggregateReadAuthority(), request = try LogbookAggregateRequest.current(.statistics)
        let token = LogbookAggregateCancellation(), outcome = ReadOutcome()
        let entered = expectation(description: "SQLite query is running"), done = expectation(description: "Reader drained")
        let release = DispatchSemaphore(value: 0), gate = NSLock()
        var paused = false
        token.onSQLiteProgress = {
            let first = gate.withLock { if paused { return false }; paused = true; return true }
            if first { entered.fulfill(); _ = release.wait(timeout: .now() + 5) }
        }
        DispatchQueue(label: "xlog.aggregate.fixture", qos: .utility).async {
            defer { done.fulfill() }
            do { _ = try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url, authority: authority, request: request, cancellation: token) }
            catch { outcome.set(error) }
        }
        wait(for: [entered], timeout: 5)
        token.cancel()
        release.signal()
        wait(for: [done], timeout: 5)
        XCTAssertTrue(outcome.error is CancellationError)
        XCTAssertFalse(token.hasRegisteredReader)
        fixture.db.close()
        try FileManager.default.moveItem(at: fixture.db.url, to: fixture.root.appendingPathComponent("after-cancel.sqlite"))
    }

    func testPureEvaluationCanCancelAfterEveryDatabaseHandleClosed() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 32)
        let readerToken = LogbookAggregateCancellation()
        let snapshot = try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url,
            authority: fixture.db.aggregateReadAuthority(), request: .current(.catalogue), cancellation: readerToken)
        XCTAssertFalse(readerToken.hasRegisteredReader)
        fixture.db.close()
        try FileManager.default.moveItem(at: fixture.db.url, to: fixture.root.appendingPathComponent("before-evaluation.sqlite"))
        let evaluation = LogbookAggregateCancellation()
        defer { evaluation.onEvaluationCheck = nil }
        var checks = 0
        evaluation.onEvaluationCheck = { checks += 1; if checks == 8 { evaluation.cancel() } }
        XCTAssertThrowsError(try snapshot.evaluate(cancellation: evaluation)) { XCTAssertTrue($0 is CancellationError) }
        XCTAssertEqual(checks, 8)
    }

    func testCloseWaitsForAnAlreadyBorrowedInterruptHandle() throws {
        let fixture = try Fixture(); defer { fixture.clean() }
        try seed(fixture.db, count: 64)
        let authority = try fixture.db.aggregateReadAuthority(), request = try LogbookAggregateRequest.current(.statistics)
        let token = LogbookAggregateCancellation(), outcome = ReadOutcome()
        let queryEntered = expectation(description: "Query active"), borrowed = expectation(description: "Interrupt borrowed")
        let detached = expectation(description: "Reader waiting to close"), done = expectation(description: "Reader closed")
        let cancelDone = expectation(description: "Interrupt returned")
        let queryRelease = DispatchSemaphore(value: 0), interruptRelease = DispatchSemaphore(value: 0)
        let gate = NSLock(); var paused = false
        token.onSQLiteProgress = {
            let first = gate.withLock { if paused { return false }; paused = true; return true }
            if first { queryEntered.fulfill(); _ = queryRelease.wait(timeout: .now() + 5) }
        }
        token.beforeInterrupt = { borrowed.fulfill(); _ = interruptRelease.wait(timeout: .now() + 5) }
        token.onReaderDetached = { detached.fulfill() }
        DispatchQueue(label: "xlog.aggregate.close.fixture", qos: .utility).async {
            defer { outcome.finish(); done.fulfill() }
            do { _ = try LogbookDatabase.readAggregateSnapshot(at: fixture.db.url, authority: authority, request: request, cancellation: token) }
            catch { outcome.set(error) }
        }
        wait(for: [queryEntered], timeout: 5)
        DispatchQueue(label: "xlog.aggregate.interrupt.fixture", qos: .utility).async { token.cancel(); cancelDone.fulfill() }
        wait(for: [borrowed], timeout: 5)
        queryRelease.signal()
        wait(for: [detached], timeout: 5)
        XCTAssertFalse(outcome.finished, "Closed a handle while sqlite3_interrupt still owned it")
        interruptRelease.signal()
        wait(for: [cancelDone, done], timeout: 5)
        XCTAssertTrue(outcome.error is CancellationError)
        XCTAssertFalse(token.hasRegisteredReader)
    }
}
