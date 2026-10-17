import Foundation
import XCTest
import CSQLitePrototype
import XContestCore
@testable import XContestStore

final class ContestDatabaseSnapshotTests: XCTestCase {
    private let sessionID = UUID(uuidString: "10000000-0000-0000-0000-000000000001")!
    private let draftID = UUID(uuidString: "20000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "ffffffff-ffff-ffff-8000-000000000007")!
    private let baseDate = Date(timeIntervalSince1970: 1_800_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testSnapshotPreservesLifecycleHistoryReplayTombstonesAndSerialCounter() async throws {
        let source = databaseURL()
        let store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let firstReservation = try await store.reserveSerial(reservationID: uuid(201), serialScope: .session, scopeValue: "",
            scope: mutation(2, revision: 1, digest: "reserve-1"), committedAt: baseDate.addingTimeInterval(1))
        let edited = draft(revision: 3, callsign: "K1ABC", sent: firstReservation.reservation.transmittedText, received: "101")
        _ = try await store.updateDraft(edited, scope: mutation(3, revision: 2, digest: "draft", draftID: draftID),
                                  committedAt: baseDate.addingTimeInterval(2))
        let qso = contact(id: uuid(301), callsign: "K1ABC", sent: "001", received: "101")
        let commitScope = mutation(4, revision: 3, digest: "commit", draftID: draftID)
        let committed = try await store.commitQSO(qso, reservationID: firstReservation.reservation.id,
                                             scope: commitScope, committedAt: baseDate.addingTimeInterval(3))
        let active = try await store.reserveSerial(reservationID: uuid(202), serialScope: .session, scopeValue: "",
            scope: mutation(5, revision: 4, digest: "reserve-2"), committedAt: baseDate.addingTimeInterval(4))
        XCTAssertEqual(active.reservation.number, 2)
        let correctedQSO = contact(id: qso.id, callsign: "K1ABD", sent: "001", received: "101")
        _ = try await store.correctQSO(correctedQSO, reason: "Correct copied call",
            operationTimestamp: baseDate.addingTimeInterval(5),
            scope: qsoMutation(6, revision: 5, digest: "correct"),
            committedAt: baseDate.addingTimeInterval(6))
        _ = try await store.deleteQSO(id: qso.id, reason: "Duplicate paper entry",
            operationTimestamp: baseDate.addingTimeInterval(7),
            scope: qsoMutation(7, revision: 6, digest: "delete"),
            committedAt: baseDate.addingTimeInterval(8))
        let sourceAudit = try await store.qsoAuditTrail(sessionID: sessionID, qsoID: qso.id)

        let destination = destinationDirectory()
        let snapshotter = ContestDatabaseSnapshotter()
        let metadata = try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                                                              destinationDirectoryURL: destination)
        let inspected = try await snapshotter.inspectSnapshot(at: destination)
        XCTAssertEqual(metadata, inspected)
        XCTAssertEqual(metadata.schemaVersion, 2)
        XCTAssertEqual(metadata.sessions, [ContestDatabaseSessionInventory(
            sessionID: sessionID, workspaceGeneration: generation, revision: 7,
            draftCount: 1, operationCount: 7, serialCounterCount: 1,
            reservationCount: 2, activeReservationCount: 1,
            qsoCount: 1, liveQSOCount: 0, deletedQSOCount: 1, auditCount: 2)])

        let copyURL = destination.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        let reopened = try SQLiteContestStore(databaseURL: copyURL)
        for table in ["sessions", "drafts", "operations", "serial_counters", "serial_reservations", "qsos", "qso_audit"] {
            XCTAssertEqual(try rawTableRows(table, at: source), try rawTableRows(table, at: copyURL), table)
        }
        let reopenedSession = try await reopened.openSession(id: sessionID)
        XCTAssertEqual(reopenedSession.session.workspaceGeneration, generation)
        XCTAssertEqual(reopenedSession.revision, 7)
        let reopenedDraft = try await reopened.draft(sessionID: sessionID, id: draftID)
        XCTAssertEqual(reopenedDraft.callsign, "")
        let reopenedReservations = try await reopened.reservations(sessionID: sessionID, draftID: draftID)
        let sourceReservations = try await store.reservations(sessionID: sessionID, draftID: draftID)
        XCTAssertEqual(reopenedReservations, sourceReservations)
        let reopenedAudit = try await reopened.qsoAuditTrail(sessionID: sessionID, qsoID: qso.id)
        XCTAssertEqual(reopenedAudit, sourceAudit)
        let reopenedReceipt = try await reopened.operationReceipt(sessionID: sessionID, workspaceGeneration: generation,
                                                                  requestID: commitScope.requestID,
                                                                  payloadDigest: commitScope.payloadDigest)
        XCTAssertEqual(reopenedReceipt, committed.receipt)
        let replay = try await reopened.commitQSO(qso, reservationID: firstReservation.reservation.id,
                                             scope: commitScope, committedAt: baseDate.addingTimeInterval(99))
        XCTAssertEqual(replay, committed)
        _ = try await reopened.transitionSerial(reservationID: active.reservation.id, to: .void,
            scope: mutation(8, revision: 7, digest: "void-active"), committedAt: baseDate.addingTimeInterval(9))
        let next = try await reopened.reserveSerial(reservationID: uuid(203), serialScope: .session, scopeValue: "",
            scope: mutation(9, revision: 8, digest: "reserve-3"), committedAt: baseDate.addingTimeInterval(10))
        XCTAssertEqual(next.reservation.number, 3)
        XCTAssertEqual(try rawScalar("PRAGMA journal_mode", at: copyURL).lowercased(), "delete")
    }

    func testWALSnapshotPinsOneRevisionWhileSecondWriterCommits() async throws {
        let source = databaseURL()
        XCTAssertEqual(try rawScalar("PRAGMA journal_mode=WAL", at: source).lowercased(), "wal")
        let first = try SQLiteContestStore(databaseURL: source)
        _ = try await create(first)
        let pinned = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
        let snapshotter = ContestDatabaseSnapshotter(hooks: .init(afterSourcePinned: {
            pinned.signal(); release.wait()
        }))
        let destination = destinationDirectory()
        let task = Task.detached { try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                                                                         destinationDirectoryURL: destination) }
        XCTAssertEqual(pinned.wait(timeout: .now() + 5), .success)
        let writer = try SQLiteContestStore(databaseURL: source)
        _ = try await writer.updateDraft(self.draft(revision: 2, callsign: "K1ABC"),
                                   scope: self.mutation(20, revision: 1, digest: "writer", draftID: self.draftID),
                                   committedAt: self.baseDate.addingTimeInterval(20))
        release.signal()
        let metadata = try await task.value
        XCTAssertEqual(metadata.sessions.first?.revision, 1)
        XCTAssertEqual(metadata.sessions.first?.operationCount, 1)
        let copied = try SQLiteContestStore(databaseURL: destination.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName))
        let copiedSession = try await copied.openSession(id: sessionID)
        let copiedDraft = try await copied.draft(sessionID: sessionID, id: draftID)
        let writerSession = try await writer.openSession(id: sessionID)
        let writerDraft = try await writer.draft(sessionID: sessionID, id: draftID)
        XCTAssertEqual(copiedSession.revision, 1)
        XCTAssertEqual(copiedDraft.callsign, "")
        XCTAssertEqual(writerSession.revision, 2)
        XCTAssertEqual(writerDraft.callsign, "K1ABC")
    }

    func testDestinationSourceAndSymlinkSafetyRefuseWithoutChangingExistingData() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let snapshotter = ContestDatabaseSnapshotter()
        let destination = destinationDirectory()
        _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source, destinationDirectoryURL: destination)
        let marker = destination.appendingPathComponent("marker")
        try Data("keep".utf8).write(to: marker)
        await assertSnapshotError(.destinationExists) {
            _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source, destinationDirectoryURL: destination)
        }
        XCTAssertEqual(try Data(contentsOf: marker), Data("keep".utf8))

        let absentParent = temporaryDirectory().appendingPathComponent("absent", isDirectory: true)
        await assertSnapshotError(.unsafePath(canonicalTemporaryPath(absentParent.path))) {
            _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                destinationDirectoryURL: absentParent.appendingPathComponent("snapshot", isDirectory: true))
        }

        #if !os(Windows)
        let sourceAlias = source.deletingLastPathComponent().appendingPathComponent("source-alias.sqlite")
        try FileManager.default.createSymbolicLink(at: sourceAlias, withDestinationURL: source)
        await assertSnapshotError(.unsafePath(canonicalTemporaryPath(sourceAlias.path))) {
            _ = try await snapshotter.createSnapshot(sourceDatabaseURL: sourceAlias,
                                                       destinationDirectoryURL: self.destinationDirectory())
        }
        let realParent = temporaryDirectory(), aliasParent = realParent.deletingLastPathComponent().appendingPathComponent("alias-\(UUID().uuidString)")
        try FileManager.default.createSymbolicLink(at: aliasParent, withDestinationURL: realParent)
        addTeardownBlock { try? FileManager.default.removeItem(at: aliasParent) }
        await assertSnapshotError(.unsafePath(canonicalTemporaryPath(aliasParent.path))) {
            _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                                                       destinationDirectoryURL: aliasParent.appendingPathComponent("snapshot"))
        }
        let hardLink = source.deletingLastPathComponent().appendingPathComponent("source-hardlink.sqlite")
        try FileManager.default.linkItem(at: source, to: hardLink)
        await assertSnapshotError(.unsafePath(canonicalTemporaryPath(hardLink.path))) {
            _ = try await snapshotter.createSnapshot(sourceDatabaseURL: hardLink,
                                                       destinationDirectoryURL: self.destinationDirectory())
        }
        #endif
    }

    func testSchemaVersionNormalLogShapeAndCorruptionAreRejected() async throws {
        let snapshotter = ContestDatabaseSnapshotter()
        for sql in [
            "CREATE TABLE normal_qsos(id TEXT PRIMARY KEY); PRAGMA user_version=2",
            "CREATE TABLE sessions(id TEXT PRIMARY KEY); PRAGMA user_version=1",
        ] {
            let source = databaseURL(create: false)
            try rawExecute(sql, at: source)
            let destination = destinationDirectory()
            do {
                _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source, destinationDirectoryURL: destination)
                XCTFail("Invalid schema published")
            } catch {}
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
            assertNoStaging(in: destination.deletingLastPathComponent())
        }

        let altered = databaseURL(), alteredStore = try SQLiteContestStore(databaseURL: altered)
        _ = try await create(alteredStore)
        try rawExecute("ALTER TABLE sessions ADD COLUMN unexpected TEXT", at: altered)
        let alteredDestination = destinationDirectory()
        do {
            _ = try await snapshotter.createSnapshot(sourceDatabaseURL: altered,
                                                       destinationDirectoryURL: alteredDestination)
            XCTFail("Altered schema published")
        } catch let error as ContestDatabaseSnapshotError {
            guard case .invalidSchema = error else { return XCTFail("Unexpected error: \(error)") }
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: alteredDestination.path))

        let corruptDirectory = temporaryDirectory(), corrupt = corruptDirectory.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        try Data(repeating: 0x7f, count: 4096).write(to: corrupt)
        do { _ = try await snapshotter.inspectSnapshot(at: corruptDirectory); XCTFail("Corruption accepted") }
        catch {}
    }

    func testBusyRetriesAreBoundedAndFreshRetrySucceeds() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let destination = destinationDirectory()
        let busy = ContestDatabaseSnapshotter(timeout: 1, busyRetryLimit: 2, busySleepMilliseconds: 1,
            hooks: .init(backupStepResult: { _ in SQLITE_BUSY }))
        await assertSnapshotError(.busyRetryLimit) {
            _ = try await busy.createSnapshot(sourceDatabaseURL: source, destinationDirectoryURL: destination)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        assertNoStaging(in: destination.deletingLastPathComponent())
        let deadlineDestination = destinationDirectory()
        let deadline = ContestDatabaseSnapshotter(timeout: 0.02, busyRetryLimit: 1_000, busySleepMilliseconds: 5,
            hooks: .init(backupStepResult: { _ in SQLITE_BUSY }))
        await assertSnapshotError(.deadlineExceeded) {
            _ = try await deadline.createSnapshot(sourceDatabaseURL: source,
                                                   destinationDirectoryURL: deadlineDestination)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: deadlineDestination.path))
        assertNoStaging(in: deadlineDestination.deletingLastPathComponent())

        let sleepEntered = DispatchSemaphore(value: 0)
        let sleepingDestination = destinationDirectory()
        let sleeping = ContestDatabaseSnapshotter(timeout: 5, busyRetryLimit: 10,
            busySleepMilliseconds: 1_000, hooks: .init(backupStepResult: { _ in
                sleepEntered.signal()
                return SQLITE_BUSY
            }))
        let sleepingTask = Task.detached {
            try await sleeping.createSnapshot(sourceDatabaseURL: source,
                                               destinationDirectoryURL: sleepingDestination)
        }
        XCTAssertEqual(sleepEntered.wait(timeout: .now() + 5), .success)
        sleepingTask.cancel()
        do { _ = try await sleepingTask.value; XCTFail("Cancelled busy sleep published") }
        catch let error as ContestDatabaseSnapshotError { XCTAssertEqual(error, .cancelled) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: sleepingDestination.path))
        assertNoStaging(in: sleepingDestination.deletingLastPathComponent())

        _ = try await ContestDatabaseSnapshotter().createSnapshot(sourceDatabaseURL: source,
                                                                   destinationDirectoryURL: destination)
    }

    func testPreAndMidCancellationAndVerificationCancellationCleanStaging() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)

        let preDestination = destinationDirectory()
        let preGate = AsyncSemaphore()
        let pre = Task {
            await preGate.wait()
            return try await ContestDatabaseSnapshotter().createSnapshot(sourceDatabaseURL: source,
                                                                           destinationDirectoryURL: preDestination)
        }
        pre.cancel(); await preGate.signal()
        do { _ = try await pre.value; XCTFail("Pre-cancelled snapshot published") }
        catch let error as ContestDatabaseSnapshotError { XCTAssertEqual(error, .cancelled) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: preDestination.path))

        let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
        let midDestination = destinationDirectory()
        let midSnapshotter = ContestDatabaseSnapshotter(pagesPerStep: 1, hooks: .init(afterBackupStep: { _ in
            entered.signal(); release.wait()
        }))
        let mid = Task.detached { try await midSnapshotter.createSnapshot(sourceDatabaseURL: source,
                                                                           destinationDirectoryURL: midDestination) }
        XCTAssertEqual(entered.wait(timeout: .now() + 5), .success)
        mid.cancel(); release.signal()
        do { _ = try await mid.value; XCTFail("Cancelled backup published") }
        catch let error as ContestDatabaseSnapshotError { XCTAssertEqual(error, .cancelled) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: midDestination.path))

        let verifyEntered = DispatchSemaphore(value: 0)
        let verifyDestination = destinationDirectory()
        let verifySnapshotter = ContestDatabaseSnapshotter(hooks: .init(beforeVerification: {
            verifyEntered.signal()
        }, verificationProbeSQL: Self.longVerificationQuery))
        let verifying = Task.detached { try await verifySnapshotter.createSnapshot(sourceDatabaseURL: source,
                                                                                    destinationDirectoryURL: verifyDestination) }
        XCTAssertEqual(verifyEntered.wait(timeout: .now() + 5), .success)
        verifying.cancel()
        do { _ = try await verifying.value; XCTFail("Cancelled verification published") }
        catch let error as ContestDatabaseSnapshotError { XCTAssertEqual(error, .cancelled) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: verifyDestination.path))
        for destination in [preDestination, midDestination, verifyDestination] {
            assertNoStaging(in: destination.deletingLastPathComponent())
        }

        let deadlineDestination = destinationDirectory()
        let verificationDeadline = ContestDatabaseSnapshotter(timeout: 0.01,
            hooks: .init(verificationProbeSQL: Self.longVerificationQuery))
        await assertSnapshotError(.deadlineExceeded) {
            _ = try await verificationDeadline.createSnapshot(sourceDatabaseURL: source,
                                                                destinationDirectoryURL: deadlineDestination)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: deadlineDestination.path))
        assertNoStaging(in: deadlineDestination.deletingLastPathComponent())
    }

    func testPrepublicationFailureAndCompetingDestinationNeverClobberAndCanRetry() async throws {
        enum Injected: Error { case stop }
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let failedDestination = destinationDirectory()
        let injected = ContestDatabaseSnapshotter(hooks: .init(beforePublication: { throw Injected.stop }))
        do { _ = try await injected.createSnapshot(sourceDatabaseURL: source, destinationDirectoryURL: failedDestination); XCTFail("Injected failure ignored") }
        catch is Injected {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: failedDestination.path))
        assertNoStaging(in: failedDestination.deletingLastPathComponent())
        _ = try await ContestDatabaseSnapshotter().createSnapshot(sourceDatabaseURL: source,
                                                                   destinationDirectoryURL: failedDestination)

        let racedDestination = destinationDirectory()
        let marker = racedDestination.appendingPathComponent("winner")
        let raced = ContestDatabaseSnapshotter(hooks: .init(beforePublication: {
            try FileManager.default.createDirectory(at: racedDestination, withIntermediateDirectories: false)
            try Data("other publisher".utf8).write(to: marker)
        }))
        await assertSnapshotError(.destinationExists) {
            _ = try await raced.createSnapshot(sourceDatabaseURL: source, destinationDirectoryURL: racedDestination)
        }
        XCTAssertEqual(try Data(contentsOf: marker), Data("other publisher".utf8))
        assertNoStaging(in: racedDestination.deletingLastPathComponent())

        let postPublicationDestination = destinationDirectory()
        let postPublication = ContestDatabaseSnapshotter(hooks: .init(afterPublication: { throw Injected.stop }))
        do {
            _ = try await postPublication.createSnapshot(sourceDatabaseURL: source,
                                                          destinationDirectoryURL: postPublicationDestination)
            XCTFail("Post-publication failure ignored")
        } catch is Injected {}
        let publishedDatabase = postPublicationDestination.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        XCTAssertTrue(FileManager.default.fileExists(atPath: publishedDatabase.path))
        let retained = try await ContestDatabaseSnapshotter().inspectSnapshot(at: postPublicationDestination)
        XCTAssertEqual(retained.schemaVersion, 2)
    }

    func testInspectorRejectsDatabaseSymlinksAndHardLinks() async throws {
        let snapshot = temporaryDirectory()
        let database = snapshot.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        let store = try SQLiteContestStore(databaseURL: database)
        _ = try await create(store)
        let metadata = try await ContestDatabaseSnapshotter().inspectSnapshot(at: snapshot)
        XCTAssertEqual(metadata.schemaVersion, 2)
        #if !os(Windows)
        let aliasDirectory = temporaryDirectory()
        let alias = aliasDirectory.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: database)
        await assertSnapshotError(.unsafePath(canonicalTemporaryPath(alias.path))) {
            _ = try await ContestDatabaseSnapshotter().inspectSnapshot(at: aliasDirectory)
        }
        #endif

        let hardLinkDirectory = temporaryDirectory()
        let hardLink = hardLinkDirectory.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        try FileManager.default.linkItem(at: database, to: hardLink)
        await assertSnapshotError(.unsafePath(canonicalTemporaryPath(hardLink.path))) {
            _ = try await ContestDatabaseSnapshotter().inspectSnapshot(at: hardLinkDirectory)
        }
    }

    func testInvalidBackupStepAndBusySleepConfigurationFailBeforeCreatingStaging() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let cases: [(ContestDatabaseSnapshotter, ContestDatabaseSnapshotError)] = [
            (ContestDatabaseSnapshotter(pagesPerStep: 0),
             .invalidConfiguration("pagesPerStep must be in 1...4096")),
            (ContestDatabaseSnapshotter(pagesPerStep: -1),
             .invalidConfiguration("pagesPerStep must be in 1...4096")),
            (ContestDatabaseSnapshotter(busySleepMilliseconds: .max),
             .invalidConfiguration("busySleepMilliseconds must be in 0...1000")),
        ]
        for (snapshotter, expected) in cases {
            let destination = destinationDirectory()
            await assertSnapshotError(expected) {
                _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                                                           destinationDirectoryURL: destination)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
            assertNoStaging(in: destination.deletingLastPathComponent())
        }
    }

    func testInspectionUsesOnePinnedReadTransaction() async throws {
        let snapshot = temporaryDirectory()
        let database = snapshot.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        let store = try SQLiteContestStore(databaseURL: database)
        let created = try await create(store)
        let writer = try RawSQLiteHandle(database)
        try writer.execute("PRAGMA journal_mode=WAL; UPDATE sessions SET revision=revision")
        let inspector = ContestDatabaseSnapshotter(hooks: .init(afterInspectionPinned: {
            try writer.execute("UPDATE sessions SET revision=revision+10")
        }))
        let metadata = try await inspector.inspectSnapshot(at: snapshot)
        XCTAssertEqual(metadata.sessions.first?.revision, created.receipt.committedRevision)
        XCTAssertEqual(try rawScalar("SELECT revision FROM sessions", at: database),
                       String(created.receipt.committedRevision + 10))
    }

    #if !os(Windows)
    func testReplacedStagingAndParentAreNeverPublishedOrDeleted() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)

        let stagingDestination = destinationDirectory()
        let stagingParent = stagingDestination.deletingLastPathComponent()
        let replacedStaging = ContestDatabaseSnapshotter(hooks: .init(afterSourcePinned: {
            let staging = try FileManager.default.contentsOfDirectory(at: stagingParent,
                                                                       includingPropertiesForKeys: nil)
                .first { $0.lastPathComponent.hasPrefix(".contest-snapshot-") }!
            let moved = stagingParent.appendingPathComponent("moved-owned-staging")
            try FileManager.default.moveItem(at: staging, to: moved)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: false)
            try Data("replacement database".utf8).write(
                to: staging.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName))
            try Data("attacker replacement".utf8).write(to: staging.appendingPathComponent("replacement-marker"))
        }))
        await assertSnapshotError(.unsafePath(canonicalTemporaryPath(stagingParent.path))) {
            _ = try await replacedStaging.createSnapshot(sourceDatabaseURL: source,
                                                           destinationDirectoryURL: stagingDestination)
        }
        let replacementStaging = try XCTUnwrap(FileManager.default.contentsOfDirectory(
            at: stagingParent, includingPropertiesForKeys: nil)
            .first { $0.lastPathComponent.hasPrefix(".contest-snapshot-") })
        XCTAssertEqual(try Data(contentsOf: replacementStaging.appendingPathComponent("replacement-marker")),
                       Data("attacker replacement".utf8))
        XCTAssertEqual(try Data(contentsOf: replacementStaging.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)),
                       Data("replacement database".utf8))
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: stagingParent.appendingPathComponent("moved-owned-staging/\(ContestDatabaseSnapshotter.databaseFileName)").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: stagingDestination.path))

        let parentDestination = destinationDirectory()
        let originalParent = parentDestination.deletingLastPathComponent()
        let movedParent = originalParent.deletingLastPathComponent()
            .appendingPathComponent("moved-parent-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: movedParent) }
        let replacementMarker = originalParent.appendingPathComponent("parent-replacement-marker")
        let replacedParent = ContestDatabaseSnapshotter(hooks: .init(afterSourcePinned: {
            try FileManager.default.moveItem(at: originalParent, to: movedParent)
            try FileManager.default.createDirectory(at: originalParent, withIntermediateDirectories: false)
            try Data("replacement parent".utf8).write(to: replacementMarker)
        }))
        await assertSnapshotError(.unsafePath(canonicalTemporaryPath(originalParent.path))) {
            _ = try await replacedParent.createSnapshot(sourceDatabaseURL: source,
                                                          destinationDirectoryURL: parentDestination)
        }
        XCTAssertEqual(try Data(contentsOf: replacementMarker), Data("replacement parent".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: parentDestination.path))
        assertNoStaging(in: movedParent)
    }
    #endif

    func testTriggersViewsAndChangedIndexSemanticsAreRejected() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let snapshot = destinationDirectory()
        _ = try await ContestDatabaseSnapshotter().createSnapshot(sourceDatabaseURL: source,
                                                                    destinationDirectoryURL: snapshot)
        let database = snapshot.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        try rawExecute("CREATE TRIGGER unexpected AFTER INSERT ON qsos BEGIN UPDATE sessions SET revision=revision; END", at: database)
        do {
            _ = try await ContestDatabaseSnapshotter().inspectSnapshot(at: snapshot)
            XCTFail("Trigger-bearing schema accepted")
        } catch let error as ContestDatabaseSnapshotError {
            guard case .invalidSchema = error else { return XCTFail("Unexpected error: \(error)") }
        }
        try rawExecute("DROP TRIGGER unexpected; CREATE VIEW unexpected AS SELECT * FROM sessions", at: database)
        do {
            _ = try await ContestDatabaseSnapshotter().inspectSnapshot(at: snapshot)
            XCTFail("View-bearing schema accepted")
        } catch let error as ContestDatabaseSnapshotError {
            guard case .invalidSchema = error else { return XCTFail("Unexpected error: \(error)") }
        }
        try rawExecute("DROP VIEW unexpected; DROP INDEX qsos_session_order; CREATE INDEX qsos_session_order ON qsos(session_id COLLATE NOCASE, is_deleted DESC, timestamp, id) WHERE is_deleted=0", at: database)
        do {
            _ = try await ContestDatabaseSnapshotter().inspectSnapshot(at: snapshot)
            XCTFail("Changed index semantics accepted")
        } catch let error as ContestDatabaseSnapshotError {
            guard case .invalidSchema = error else { return XCTFail("Unexpected error: \(error)") }
        }

        let foreignKeySnapshot = destinationDirectory()
        _ = try await ContestDatabaseSnapshotter().createSnapshot(sourceDatabaseURL: source,
                                                                    destinationDirectoryURL: foreignKeySnapshot)
        let foreignKeyDatabase = foreignKeySnapshot.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)
        try rawExecute("""
            PRAGMA foreign_keys=OFF;
            BEGIN;
            CREATE TABLE drafts_new(
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
              revision INTEGER NOT NULL, snapshot BLOB NOT NULL, updated_at REAL NOT NULL,
              UNIQUE(session_id, id)
            );
            INSERT INTO drafts_new SELECT * FROM drafts;
            DROP TABLE drafts;
            ALTER TABLE drafts_new RENAME TO drafts;
            COMMIT;
            """, at: foreignKeyDatabase)
        do {
            _ = try await ContestDatabaseSnapshotter().inspectSnapshot(at: foreignKeySnapshot)
            XCTFail("Changed foreign-key semantics accepted")
        } catch let error as ContestDatabaseSnapshotError {
            guard case .invalidSchema = error else { return XCTFail("Unexpected error: \(error)") }
        }
    }

    #if os(Windows)
    func testWindowsDriveTypeClassificationAndTemporaryDriveSupport() throws {
        // GetDriveTypeW constants: unknown 0, missing root 1, removable 2,
        // fixed 3, remote 4, CD-ROM 5, and RAM disk 6.
        XCTAssertTrue(windowsSnapshotDriveTypeIsSupported(2))
        XCTAssertTrue(windowsSnapshotDriveTypeIsSupported(3))
        XCTAssertTrue(windowsSnapshotDriveTypeIsSupported(6))
        XCTAssertFalse(windowsSnapshotDriveTypeIsSupported(0))
        XCTAssertFalse(windowsSnapshotDriveTypeIsSupported(1))
        XCTAssertFalse(windowsSnapshotDriveTypeIsSupported(4))
        XCTAssertFalse(windowsSnapshotDriveTypeIsSupported(5))
        XCTAssertNoThrow(try windowsSnapshotPath(FileManager.default.temporaryDirectory.path))
    }

    func testWindowsHeldHandlesDenyEarlyStagingAndParentMoves() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let destination = destinationDirectory()
        let parent = destination.deletingLastPathComponent()
        let observations = LockedFlags()
        let snapshotter = ContestDatabaseSnapshotter(hooks: .init(afterSourcePinned: {
            let staging = try FileManager.default.contentsOfDirectory(at: parent,
                                                                       includingPropertiesForKeys: nil)
                .first { $0.lastPathComponent.hasPrefix(".contest-snapshot-") }!
            do {
                try FileManager.default.moveItem(at: staging,
                    to: parent.appendingPathComponent("unexpected-moved-staging"))
            } catch {
                observations.setStagingMoveDenied()
            }
            do {
                try FileManager.default.moveItem(at: parent,
                    to: parent.deletingLastPathComponent().appendingPathComponent("unexpected-moved-parent"))
            } catch {
                observations.setParentMoveDenied()
            }
        }))
        _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                                                  destinationDirectoryURL: destination)
        XCTAssertTrue(observations.stagingMoveDenied)
        XCTAssertTrue(observations.parentMoveDenied)
        let metadata = try await ContestDatabaseSnapshotter().inspectSnapshot(at: destination)
        XCTAssertEqual(metadata.schemaVersion, 2)
    }

    func testWindowsDatabaseChildClosesBeforePublicationWhileDirectoryPinsRemain() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let destination = destinationDirectory()
        let parent = destination.deletingLastPathComponent()
        let moved = parent.appendingPathComponent("temporarily-moved-staging")
        let history = LockedHistory()
        let snapshotter = ContestDatabaseSnapshotter(hooks: .init(afterDatabaseClosed: {
            let staging = try FileManager.default.contentsOfDirectory(at: parent,
                                                                       includingPropertiesForKeys: nil)
                .first { $0.lastPathComponent.hasPrefix(".contest-snapshot-") }!
            do {
                try FileManager.default.moveItem(at: staging, to: moved)
                history.append("held-child-move-succeeded")
            } catch {
                history.append("held-child-move-denied")
            }
        }, beforePublication: {
            let staging = try FileManager.default.contentsOfDirectory(at: parent,
                                                                       includingPropertiesForKeys: nil)
                .first { $0.lastPathComponent.hasPrefix(".contest-snapshot-") }!
            try FileManager.default.moveItem(at: staging, to: moved)
            history.append("late-move-succeeded")
            do {
                try FileManager.default.moveItem(
                    at: parent,
                    to: parent.deletingLastPathComponent().appendingPathComponent("unexpected-moved-parent"))
                history.append("late-parent-move-succeeded")
            } catch {
                history.append("late-parent-move-denied")
            }
            try FileManager.default.moveItem(at: moved, to: staging)
            history.append("late-move-restored")
        }))
        _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                                                  destinationDirectoryURL: destination)
        XCTAssertEqual(history.values, [
            "held-child-move-denied",
            "late-move-succeeded",
            "late-parent-move-denied",
            "late-move-restored",
        ])
        let metadata = try await ContestDatabaseSnapshotter().inspectSnapshot(at: destination)
        XCTAssertEqual(metadata.schemaVersion, 2)
    }

    func testWindowsErrorAfterDatabaseChildCloseCleansOwnedStaging() async throws {
        enum Injected: Error { case stop }
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let destination = destinationDirectory()
        let history = LockedHistory()
        let snapshotter = ContestDatabaseSnapshotter(hooks: .init(beforePublication: {
            history.append("publication-phase")
            throw Injected.stop
        }))
        do {
            _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                                                       destinationDirectoryURL: destination)
            XCTFail("Injected failure ignored")
        } catch is Injected {}
        XCTAssertEqual(history.values, ["publication-phase"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        assertNoStaging(in: destination.deletingLastPathComponent())

        let cancelDestination = destinationDirectory()
        let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
        let cancellable = ContestDatabaseSnapshotter(hooks: .init(beforePublication: {
            entered.signal()
            release.wait()
        }))
        let task = Task.detached {
            try await cancellable.createSnapshot(sourceDatabaseURL: source,
                                                  destinationDirectoryURL: cancelDestination)
        }
        XCTAssertEqual(entered.wait(timeout: .now() + 5), .success)
        task.cancel()
        release.signal()
        do {
            _ = try await task.value
            XCTFail("Cancelled publication phase published")
        } catch let error as ContestDatabaseSnapshotError {
            XCTAssertEqual(error, .cancelled)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: cancelDestination.path))
        assertNoStaging(in: cancelDestination.deletingLastPathComponent())
    }

    func testWindowsLateStagingReplacementIsPreservedAndOwnedHandlesAreCleaned() async throws {
        let source = databaseURL(), store = try SQLiteContestStore(databaseURL: source)
        _ = try await create(store)
        let destination = destinationDirectory()
        let parent = destination.deletingLastPathComponent()
        let moved = parent.appendingPathComponent("moved-owned-staging")
        let snapshotter = ContestDatabaseSnapshotter(hooks: .init(beforePublication: {
            let staging = try FileManager.default.contentsOfDirectory(at: parent,
                                                                       includingPropertiesForKeys: nil)
                .first { $0.lastPathComponent.hasPrefix(".contest-snapshot-") }!
            try FileManager.default.moveItem(at: staging, to: moved)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: false)
            try Data("replacement database".utf8).write(
                to: staging.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName))
            try Data("attacker replacement".utf8).write(to: staging.appendingPathComponent("replacement-marker"))
        }))
        var snapshotError: ContestDatabaseSnapshotError?
        do {
            _ = try await snapshotter.createSnapshot(sourceDatabaseURL: source,
                                                       destinationDirectoryURL: destination)
            XCTFail("Replaced staging directory published")
        } catch let error as ContestDatabaseSnapshotError {
            snapshotError = error
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        let replacement = try XCTUnwrap(FileManager.default.contentsOfDirectory(
            at: parent, includingPropertiesForKeys: nil)
            .first { $0.lastPathComponent.hasPrefix(".contest-snapshot-") })
        XCTAssertEqual(snapshotError, .unsafePath(canonicalTemporaryPath(replacement.path)))
        XCTAssertEqual(try Data(contentsOf: replacement.appendingPathComponent("replacement-marker")),
                       Data("attacker replacement".utf8))
        XCTAssertEqual(try Data(contentsOf: replacement.appendingPathComponent(ContestDatabaseSnapshotter.databaseFileName)),
                       Data("replacement database".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: moved.path))
    }
    #endif

    private func create(_ store: SQLiteContestStore) async throws -> ContestSessionCreationResult {
        try await store.createSession(session(), metadata: ContestSessionMetadata(name: "Snapshot fixture", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
                                      initialDraft: draft(revision: 1), scope: mutation(1, revision: 0, digest: "create"), committedAt: baseDate)
    }

    private static let longVerificationQuery = """
        WITH RECURSIVE count(value) AS (
          VALUES(0) UNION ALL SELECT value + 1 FROM count WHERE value < 100000000
        ) SELECT sum(value) FROM count
        """

    private func session() -> ContestSessionSnapshot {
        ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation, rule: CQWPXCWRule.identity,
            referenceDataVersion: "cty-2026-10-17", startedAt: baseDate,
            station: ContestStationSnapshot(callsign: "OM0RX", entity: om, sentExchange: "001",
                                            operatorCallsigns: ["OM0RX"], location: "JN98"))
    }

    private func draft(revision: UInt64, callsign: String = "", sent: String = "", received: String = "") -> ContestDraftSnapshot {
        ContestDraftSnapshot(id: draftID, sessionID: sessionID, revision: revision,
            updatedAt: baseDate.addingTimeInterval(Double(revision)), callsign: callsign, band: "20m", mode: "CW",
            frequencyHz: 14_025_000, rstSent: "599", rstReceived: "599",
            exchange: ContestExchangeSnapshot(rawSent: sent, normalizedSent: sent, rawReceived: received, normalizedReceived: received),
            entity: callsign.isEmpty ? nil : usa, operatorCallsign: "OM0RX", stationLocation: "JN98")
    }

    private func contact(id: UUID, callsign: String, sent: String, received: String) -> ContestQSO {
        ContestQSO(id: id, sessionID: sessionID, timestampUTC: baseDate.addingTimeInterval(30), callsign: callsign,
            band: "20m", mode: "CW", frequencyHz: 14_025_000, rstSent: "599", rstReceived: "599",
            exchange: ContestExchangeSnapshot(rawSent: sent, normalizedSent: sent, rawReceived: received, normalizedReceived: received),
            entity: usa, operatorCallsign: "OM0RX", stationLocation: "JN98",
            provenance: ContestQSOProvenance(source: .operatorEntry))
    }

    private func mutation(_ number: Int, revision: UInt64, digest: String, draftID: UUID? = nil) -> ContestMutationScope {
        ContestMutationScope(sessionID: sessionID, workspaceGeneration: generation, requestID: uuid(1_000 + number),
                             expectedRevision: revision, draftID: draftID ?? self.draftID, payloadDigest: digest)
    }

    private func qsoMutation(_ number: Int, revision: UInt64, digest: String) -> ContestMutationScope {
        ContestMutationScope(sessionID: sessionID, workspaceGeneration: generation, requestID: uuid(1_000 + number),
                             expectedRevision: revision, draftID: nil, payloadDigest: digest)
    }

    private func uuid(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!
    }

    private func temporaryDirectory() -> URL {
        let value = FileManager.default.temporaryDirectory.appendingPathComponent("xcontest-snapshot-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: value, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: value) }
        return value
    }

    private func databaseURL(create: Bool = true) -> URL {
        let parent = temporaryDirectory(), url = parent.appendingPathComponent("source.sqlite")
        if !create { return url }
        return url
    }

    private func destinationDirectory() -> URL {
        temporaryDirectory().appendingPathComponent("published", isDirectory: true)
    }

    private func canonicalTemporaryPath(_ path: String) -> String {
        #if os(macOS)
        return path.hasPrefix("/var/") ? "/private" + path : path
        #else
        return path
        #endif
    }

    private func assertNoStaging(in parent: URL, file: StaticString = #filePath, line: UInt = #line) {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: parent.path)) ?? []
        XCTAssertFalse(names.contains { $0.hasPrefix(".contest-snapshot-") }, file: file, line: line)
    }

    private func assertSnapshotError(_ expected: ContestDatabaseSnapshotError,
                                     operation: () async throws -> Void,
                                     file: StaticString = #filePath, line: UInt = #line) async {
        do { try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
        catch let error as ContestDatabaseSnapshotError { XCTAssertEqual(error, expected, file: file, line: line) }
        catch { XCTFail("Unexpected error: \(error)", file: file, line: line) }
    }

    private func rawExecute(_ sql: String, at url: URL) throws {
        var database: OpaquePointer?
        guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else { throw ContestStoreError.database("raw open") }
        defer { sqlite3_close(database) }
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw ContestStoreError.database(String(cString: sqlite3_errmsg(database)))
        }
    }

    private func rawScalar(_ sql: String, at url: URL) throws -> String {
        var database: OpaquePointer?
        guard sqlite3_open(url.path, &database) == SQLITE_OK, let database else { throw ContestStoreError.database("raw open") }
        defer { sqlite3_close(database) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw ContestStoreError.database(String(cString: sqlite3_errmsg(database)))
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW, let value = sqlite3_column_text(statement, 0) else {
            throw ContestStoreError.database("raw scalar")
        }
        return String(cString: value)
    }

    private func rawTableRows(_ table: String, at url: URL) throws -> [[String]] {
        var database: OpaquePointer?
        guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let database else {
            throw ContestStoreError.database("raw open")
        }
        defer { sqlite3_close(database) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT * FROM \(table) ORDER BY rowid", -1, &statement, nil) == SQLITE_OK,
              let statement else { throw ContestStoreError.database(String(cString: sqlite3_errmsg(database))) }
        defer { sqlite3_finalize(statement) }
        var result: [[String]] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            result.append((0..<sqlite3_column_count(statement)).map { index in
                switch sqlite3_column_type(statement, index) {
                case SQLITE_NULL: return "null"
                case SQLITE_INTEGER: return "i:\(sqlite3_column_int64(statement, index))"
                case SQLITE_FLOAT: return "f:\(sqlite3_column_double(statement, index).bitPattern)"
                case SQLITE_TEXT:
                    return "t:" + String(cString: sqlite3_column_text(statement, index))
                case SQLITE_BLOB:
                    let count = Int(sqlite3_column_bytes(statement, index))
                    guard count > 0, let bytes = sqlite3_column_blob(statement, index) else { return "b:" }
                    return "b:" + Data(bytes: bytes, count: count).map { String(format: "%02x", $0) }.joined()
                default: return "unknown"
                }
            })
        }
        return result
    }
}

private final class LockedFlags: @unchecked Sendable {
    private let lock = NSLock()
    private var values = (staging: false, parent: false)

    var stagingMoveDenied: Bool { lock.withLock { values.staging } }
    var parentMoveDenied: Bool { lock.withLock { values.parent } }
    func setStagingMoveDenied() { lock.withLock { values.staging = true } }
    func setParentMoveDenied() { lock.withLock { values.parent = true } }
}

private final class LockedHistory: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var values: [String] { lock.withLock { storage } }
    func append(_ value: String) { lock.withLock { storage.append(value) } }
}

private actor AsyncSemaphore {
    private var continuation: CheckedContinuation<Void, Never>?
    private var signalled = false
    func wait() async {
        if signalled { return }
        await withCheckedContinuation { continuation = $0 }
    }
    func signal() {
        signalled = true
        continuation?.resume()
        continuation = nil
    }
}

private final class RawSQLiteHandle: @unchecked Sendable {
    private let database: OpaquePointer

    init(_ url: URL) throws {
        var value: OpaquePointer?
        guard sqlite3_open(url.path, &value) == SQLITE_OK, let value else {
            sqlite3_close(value)
            throw ContestStoreError.database("raw open")
        }
        database = value
    }

    deinit { sqlite3_close(database) }

    func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw ContestStoreError.database(String(cString: sqlite3_errmsg(database)))
        }
    }
}
