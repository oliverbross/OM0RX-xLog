import Foundation
import XCTest
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

final class StandaloneModeTests: XCTestCase {
    private struct Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-mode-" + UUID().uuidString)
        let logbook: LiveLogbookMethods
        init() throws {
            logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
            _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
            var fields = try XCTUnwrap(logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
            fields["logbookMode"] = "wavelog"; fields["wavelogURL"] = "https://mode-fixture.invalid"; fields["wavelogStationID"] = 1
            _ = try logbook.saveSettingsForTest(fields)
        }
        func cleanup() {
            if let workspace = try? IntegrationWorkspaceBootstrap.open(at: logbook.workspaceDirectoryURL) {
                workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName)
            }
            try? logbook.openedDatabase().close()
            try? FileManager.default.removeItem(at: root)
        }
        func stored() throws -> IntegrationSettingsSnapshot {
            try logbook.openedDatabase().integrationSettings(seed: .defaults)
        }
        /// Simulate a crash after the SQLite commit but before native cleanup.
        /// Intentionally bypass the service's UserDefaults consent removal.
        func databaseMode(_ mode: LogbookMode) throws {
            let snapshot = try stored()
            var settings = snapshot.settings; settings.logbookMode = mode
            _ = try logbook.openedDatabase().applyIntegrationSettings(.init(operationID: UUID(), expectedRevision: snapshot.revision, settings: settings))
        }
    }

    func testModeEpochCommitsAtomicallyAndOldConsentCannotReviveAfterCrashOrRestart() async throws {
        let fixture = try Fixture(); defer { fixture.cleanup() }
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 3, confirmed: true)
        let before = try fixture.stored()
        try fixture.databaseMode(.local)
        XCTAssertEqual(try fixture.stored().syncTargetRevision, before.syncTargetRevision + 1)
        let reopened = LiveLogbookMethods(supportDirectory: fixture.root, inheritNativePreferences: false)
        XCTAssertEqual(try reopened.currentSettings().logbookMode, .local)
        XCTAssertFalse(try reopened.currentSettings().automaticSync)
        try fixture.databaseMode(.wavelog)
        XCTAssertEqual(try fixture.stored().syncTargetRevision, before.syncTargetRevision + 2)
        XCTAssertFalse(try reopened.currentSettings().automaticSync, "Matching the old URL/station is not fresh consent")
        let starts = ModeStartCounter()
        let service = LiveServiceMethods(logbook: reopened, operation: { _, _ in await starts.increment(); return SyncReport() })
        await service.automaticTick(now: .distantFuture)
        let count = await starts.count; XCTAssertEqual(count, 0)
        await service.terminate()
        try reopened.openedDatabase().close()
    }

    func testModeSwitchPreservesContactsMappingsConflictsAndPendingChanges() throws {
        let fixture = try Fixture(); defer { fixture.cleanup() }
        let db = try fixture.logbook.openedDatabase()
        let contact = QSO(wavelogID: 42, call: "OM0RX", start: Date(timeIntervalSince1970: 1_790_000_000), band: "20m", mode: "CW", frequencyHz: 14_025_000, comment: "local", extraFields: ["APP_FUTURE": "retain"])
        try db.save(contact)
        var remote = contact; remote.id = UUID(); remote.isDirty = false; remote.comment = "remote"
        _ = try db.mergeRemote(remote)
        let before = try XCTUnwrap(db.lookup(localID: contact.id))
        let conflicts = try db.conflicts().map(\.id), outbox = try db.outboxEntries().map(\.id)
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 3, confirmed: true)
        for mode in ["local", "wavelog"] {
            var fields = try XCTUnwrap(fixture.logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
            fields["logbookMode"] = mode
            _ = try fixture.logbook.saveSettingsForTest(fields)
            XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
            XCTAssertEqual(try db.lookup(localID: contact.id), before)
            XCTAssertEqual(try db.conflicts().map(\.id), conflicts)
            XCTAssertEqual(try db.outboxEntries().map(\.id), outbox)
        }
    }

    func testLocalModeRejectsManualAndAutomaticNetworkBeforeCredentialsOrTransport() async throws {
        let fixture = try Fixture(); defer { fixture.cleanup() }
        try fixture.databaseMode(.local)
        // No injected transport: a misplaced credential read would touch the
        // platform vault. Both checks must return at the explicit mode guard.
        let service = LiveServiceMethods(logbook: fixture.logbook)
        for (method, params) in [("sync_run", ["confirm_single_writer": true] as [String: Any]),
                                  ("sync_configure", ["enabled": true, "interval_minutes": 5, "confirm_single_writer": true])] {
            do { _ = try await service.handle(method: method, params: params); XCTFail("Local network operation admitted") }
            catch let error as WorkerFailure { XCTAssertEqual(error.code, "sync_mode_local") }
        }
        await service.automaticTick(now: .distantFuture)
        let status = try await service.handle(method: "sync_status", params: [:])
        XCTAssertEqual(status["sync_available"] as? Bool, false)
        XCTAssertEqual(status["running"] as? Bool, false)
        await service.terminate()
    }

    func testOrdinarySettingsSaveRetainsConsentButLegacyConsentCannotAuthorize() throws {
        let fixture = try Fixture(); defer { fixture.cleanup() }
        try fixture.logbook.configureAutomaticSync(enabled: true, intervalMinutes: 3, confirmed: true)
        let before = try fixture.stored()
        var fields = try XCTUnwrap(fixture.logbook.handle(method: "settings_load", params: [:])["settings"] as? [String: Any])
        fields["stationLocation"] = "Offline fixture"
        _ = try fixture.logbook.saveSettingsForTest(fields)
        XCTAssertEqual(try fixture.stored().syncTargetRevision, before.syncTargetRevision)
        XCTAssertTrue(try fixture.logbook.currentSettings().automaticSync)
        let workspace = try IntegrationWorkspaceBootstrap.open(at: fixture.logbook.workspaceDirectoryURL)
        let defaults = try XCTUnwrap(workspace.makeDefaults())
        let key = "OM0RX-xLog.sync-authorization.v1"
        var authorization = try JSONSerialization.jsonObject(with: XCTUnwrap(defaults.data(forKey: key))) as! [String: Any]
        authorization["version"] = 1; authorization.removeValue(forKey: "targetRevision")
        defaults.set(try JSONSerialization.data(withJSONObject: authorization), forKey: key)
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync, "Legacy consent cannot prove a mode epoch")
    }

    func testLegacySettingsSnapshotDefaultsEpochWithoutInventingConsent() throws {
        let snapshot = IntegrationSettingsSnapshot(revision: 3, settings: .defaults)
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot)) as! [String: Any]
        object.removeValue(forKey: "syncTargetRevision")
        let decoded = try JSONDecoder().decode(IntegrationSettingsSnapshot.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(decoded.syncTargetRevision, 0)
        try decoded.validate()
    }
    func testStoredAutomaticFlagCannotReplaceNativeConsent() async throws {
        let fixture = try Fixture(); defer { fixture.cleanup() }
        let snapshot = try fixture.stored()
        var settings = snapshot.settings; settings.automaticSync = true
        _ = try fixture.logbook.openedDatabase().applyIntegrationSettings(.init(operationID: UUID(), expectedRevision: snapshot.revision, settings: settings))
        XCTAssertFalse(try fixture.logbook.currentSettings().automaticSync)
        XCTAssertEqual(try fixture.logbook.handle(method: "settings_load", params: [:])["automatic_sync"] as? Bool, false)
        let starts = ModeStartCounter()
        let service = LiveServiceMethods(logbook: fixture.logbook, operation: { _, _ in await starts.increment(); return SyncReport() })
        await service.automaticTick(now: .distantFuture)
        let count = await starts.count; XCTAssertEqual(count, 0)
        await service.terminate()
    }
}

private actor ModeStartCounter {
    var count = 0
    func increment() { count += 1 }
}
